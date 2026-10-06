// Paste into Supabase → Edge Functions → new function "create-referral". Turn "Enforce JWT Verification" OFF.
// Doctor / ER officer / dept head / admin. Body: { patient_id, direction: in|out, to_facility?, from_facility?, reason, urgency, contact_person?, contact_phone?, visit_id?, emergency_case_id?, summary?, preview? }.
// preview:true returns the prefilled summary (from the ER case, latest visit, diagnoses, vitals, medicines) without saving. Referring an ER case out also closes it with outcome "refer".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
// Hospital clock: Pakistan Standard Time (UTC+5, no daylight saving).
const TZ = "+05:00";
// deno-lint-ignore no-explicit-any
type DB = any;

async function getCaller(req: Request, db: DB) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return { error: fail("unauthorized", "Please sign in again.", 401) };
  let userId = u.user.id;
  let impersonatedBy: string | null = null;
  const impId = req.headers.get("x-impersonation-session");
  if (impId) {
    const { data: s } = await db.from("impersonation_sessions").select("*").eq("id", impId).maybeSingle();
    if (!s || s.super_admin_id !== userId || s.ended_at || new Date(s.expires_at) < new Date())
      return { error: fail("forbidden", "Acting session is not active.", 403) };
    impersonatedBy = userId; userId = s.target_user_id;
  }
  const { data: prof } = await db.from("profiles").select("hospital_id, is_active").eq("id", userId).maybeSingle();
  if (!prof?.is_active) return { error: fail("forbidden", "Account is not active.", 403) };
  const { data: r } = await db.from("user_roles").select("role").eq("user_id", userId).eq("hospital_id", prof.hospital_id);
  return { userId, impersonatedBy, hospitalId: prof.hospital_id as string, roles: (r ?? []).map((x) => x.role as string) };
}
// deno-lint-ignore no-explicit-any
async function audit(db: DB, req: Request, c: any, action: string, resource: string, id: string | null, before: unknown, after: unknown) {
  await db.from("audit_logs").insert({ hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action,
    resource, resource_id: id, before, after, ip: req.headers.get("x-forwarded-for") });
}
const BOOT = async (req: Request) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  const b = await req.json().catch(() => ({}));
  return { db, c, b };
};
const has = (c: { roles: string[] }, list: string[]) => c.roles.some((r) => list.includes(r));
// deno-lint-ignore no-explicit-any
const ROLES = ["super_admin", "admin", "dept_head", "doctor", "er_officer"];
const URG = ["routine", "urgent", "emergency"];
const s = (v: unknown, max = 500) => { const t = String(v ?? "").trim().slice(0, max); return t || null; };
const pk = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" });
// deno-lint-ignore no-explicit-any
async function buildSummary(db: DB, hospitalId: string, patientId: string, visitId: string | null, ec: any): Promise<string> {
  const out: string[] = [];
  const { data: p } = await db.from("patients").select("dob, gender, blood_group, allergies, chronic_conditions").eq("id", patientId).maybeSingle();
  if (p) {
    const age = p.dob ? Math.floor((Date.now() - new Date(p.dob).getTime()) / 31557600000) : null;
    out.push([age != null ? `${age} y` : null, p.gender, p.blood_group ? `Blood group ${p.blood_group}` : null].filter(Boolean).join(", "));
    if (p.allergies?.length) out.push(`Allergies: ${p.allergies.join(", ")}`);
    if (p.chronic_conditions?.length) out.push(`Known conditions: ${p.chronic_conditions.join(", ")}`);
  }
  if (ec) {
    out.push(`Emergency arrival ${pk(ec.arrived_at)} (${String(ec.arrival_mode).replace("_", " ")}). Complaint: ${ec.complaint}`);
    if (ec.triage_color) out.push(`Triage: ${ec.triage_color}`);
    if (ec.mlc) out.push(`Medico-legal case${ec.mlc_details?.fir_no ? `, FIR ${ec.mlc_details.fir_no}` : ""}${ec.mlc_details?.police_station ? `, ${ec.mlc_details.police_station}` : ""}`);
  }
  let v = null;
  if (visitId) v = (await db.from("visits").select("*").eq("id", visitId).eq("hospital_id", hospitalId).maybeSingle()).data;
  else {
    const since = ec ? ec.arrived_at : new Date(Date.now() - 30 * 86400e3).toISOString();
    v = (await db.from("visits").select("*").eq("hospital_id", hospitalId).eq("patient_id", patientId).gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle()).data;
  }
  if (v) {
    out.push(`Visit ${pk(v.created_at)}`);
    if (v.chief_complaint) out.push(`Presenting complaint: ${v.chief_complaint}`);
    if (v.history) out.push(`History: ${v.history}`);
    if (v.examination) out.push(`Examination: ${v.examination}`);
    const { data: dx } = await db.from("visit_diagnoses").select("icd10_code, description, is_primary").eq("visit_id", v.id).order("is_primary", { ascending: false });
    if (dx?.length) out.push(`Diagnosis: ${dx.map((d: { icd10_code: string; description: string }) => `${d.icd10_code} ${d.description}`).join("; ")}`);
    if (v.plan) out.push(`Plan / treatment given: ${v.plan}`);
    const { data: rx } = await db.from("prescriptions").select("id").eq("visit_id", v.id);
    const ids = (rx ?? []).map((r: { id: string }) => r.id);
    if (ids.length) {
      const { data: it } = await db.from("prescription_items").select("medicine_name, dose, frequency, route").in("prescription_id", ids);
      if (it?.length) out.push(`Medicines: ${it.map((i: Record<string, string>) => [i.medicine_name, i.dose, i.frequency, i.route].filter(Boolean).join(" ")).join("; ")}`);
    }
  }
  const { data: vt } = await db.from("vitals").select("*").eq("patient_id", patientId).eq("hospital_id", hospitalId).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
  if (vt) out.push(`Last vitals (${pk(vt.recorded_at)}): ` + [vt.bp_sys && vt.bp_dia ? `BP ${vt.bp_sys}/${vt.bp_dia}` : null, vt.pulse ? `Pulse ${vt.pulse}` : null,
    vt.rr ? `RR ${vt.rr}` : null, vt.temp_c ? `Temp ${vt.temp_c}°C` : null, vt.spo2 ? `SpO2 ${vt.spo2}%` : null].filter(Boolean).join(", "));
  return out.filter(Boolean).join("\n");
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ROLES)) return fail("forbidden", "Only doctors and ER officers can create referrals.", 403);
  const direction = b.direction === "in" ? "in" : "out";
  const { data: pat } = await db.from("patients").select("id").eq("id", String(b.patient_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  let ec = null;
  if (b.emergency_case_id) {
    ec = (await db.from("emergency_cases").select("*").eq("id", String(b.emergency_case_id)).eq("hospital_id", c.hospitalId).maybeSingle()).data;
    if (!ec) return fail("not_found", "Emergency case not found.", 404);
    if (ec.disposition && ec.disposition !== "refer") return fail("closed", "This emergency case is already closed.", 409);
  }
  const patientId = ec?.patient_id ?? pat?.id;
  if (!patientId) return fail("not_found", "Patient not found.", 404);
  const visitId = s(b.visit_id, 40);
  if (b.preview) return json({ ok: true, data: { summary: await buildSummary(db, c.hospitalId, patientId, visitId, ec) } });
  const { data: hosp } = await db.from("hospitals").select("name").eq("id", c.hospitalId).maybeSingle();
  const here = hosp?.name ?? "This hospital";
  const other = s(direction === "out" ? b.to_facility : b.from_facility, 200);
  const reason = s(b.reason, 2000);
  if (!other) return fail("invalid", direction === "out" ? "Enter the facility you are referring to." : "Enter the referring facility.");
  if (!reason) return fail("invalid", "Enter the reason for referral.");
  if (!URG.includes(b.urgency)) return fail("invalid", "Choose the urgency.");
  const phone = s(b.contact_phone, 30);
  if (phone && !/^[+\d][\d\s-]{6,}$/.test(phone)) return fail("invalid", "Contact phone is not valid.");
  const summary = s(b.summary, 8000) ?? (direction === "out" ? await buildSummary(db, c.hospitalId, patientId, visitId, ec) : null);
  const { data: prof } = await db.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const now = new Date().toISOString();
  const { data: row, error } = await db.from("referrals").insert({
    hospital_id: c.hospitalId, patient_id: patientId, direction, from_facility: direction === "out" ? here : other, to_facility: direction === "out" ? other : here,
    reason, summary, urgency: b.urgency, status: direction === "in" ? "accepted" : "sent", status_at: now, contact_person: s(b.contact_person, 200), contact_phone: phone,
    visit_id: visitId, emergency_case_id: ec?.id ?? null, referred_by: c.userId, referred_by_name: prof?.full_name ?? null, created_by: c.userId,
  }).select().single();
  if (error) return fail(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? "This emergency case already has a referral." : "Could not save the referral.", error.code === "23505" ? 409 : 500);
  if (ec && !ec.disposition && direction === "out") {
    await db.from("emergency_cases").update({ disposition: "refer", disposition_at: now, disposition_note: `Referred to ${other}: ${reason}`.slice(0, 2000), updated_at: now })
      .eq("id", ec.id).is("disposition", null);
    if (ec.bay_bed_id) await db.from("beds").update({ status: "cleaning", updated_at: now }).eq("id", ec.bay_bed_id).eq("status", "occupied").is("current_admission_id", null);
    await audit(db, req, c, "disposition", "emergency_case", ec.id, null, { disposition: "refer", referral_id: row.id });
  }
  await audit(db, req, c, "create", "referral", row.id, null, row);
  return json({ ok: true, data: row });
});
