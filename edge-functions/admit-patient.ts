// Paste into Supabase → Edge Functions → new function "admit-patient". Turn "Enforce JWT Verification" OFF.
// Admit a patient. Body: { patient_id, bed_id, doctor_id, department_id?, reason, deposit_amount?, request_id? }. Bed must be free (or reserved for this request) and match the patient's gender; it becomes occupied.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
const BOOKING_ROLES = ["super_admin", "admin", "receptionist", "dept_head", "doctor", "er_officer"];
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
const genderOk = (wardGender: string, patientGender: string | null) => wardGender === "any" || wardGender === patientGender;
// deno-lint-ignore no-explicit-any
async function bedWithWard(db: DB, hospitalId: string, bedId: string): Promise<any> {
  const { data } = await db.from("beds").select("*, wards!inner(id, name, gender, is_active, hospital_id)").eq("id", bedId).eq("hospital_id", hospitalId).maybeSingle();
  return data;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ["super_admin", "admin", "dept_head", "doctor", "er_officer", "receptionist", "nurse"])) return fail("forbidden", "You can't admit patients.", 403);
  const reason = String(b.reason ?? "").trim().slice(0, 1000);
  if (reason.length < 3) return fail("invalid", "Write the reason for admission.");
  const deposit = Number(b.deposit_amount ?? 0);
  if (!Number.isFinite(deposit) || deposit < 0) return fail("invalid", "Deposit must be 0 or more.");
  const { data: p } = await db.from("patients").select("id, gender, merged_into").eq("id", String(b.patient_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!p || p.merged_into) return fail("not_found", "Patient not found.", 404);
  const { data: doc } = await db.from("doctors").select("id, department_id").eq("id", String(b.doctor_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!doc) return fail("invalid", "Choose the admitting doctor.");
  const bed = await bedWithWard(db, c.hospitalId, String(b.bed_id ?? ""));
  if (!bed || !bed.wards.is_active) return fail("not_found", "Bed not found.", 404);
  if (!genderOk(bed.wards.gender, p.gender)) return fail("gender", "This ward doesn't match the patient's gender.", 409);
  // deno-lint-ignore no-explicit-any
  let request: any = null;
  if (b.request_id) {
    const { data } = await db.from("bed_requests").select("*").eq("id", String(b.request_id)).eq("hospital_id", c.hospitalId).maybeSingle();
    if (!data || data.patient_id !== p.id || !["pending", "allotted"].includes(data.status)) return fail("invalid", "Bed request doesn't match.");
    request = data;
  }
  const fromStatus = request?.bed_id === bed.id ? "reserved" : "free";
  if (bed.status !== fromStatus) return fail("bed_taken", "That bed is no longer free.", 409);
  const now = new Date().toISOString();
  // 1) Create the admission (unique indexes stop double admission of a patient or a bed).
  const { data: adm, error } = await db.from("admissions").insert({
    hospital_id: c.hospitalId, patient_id: p.id, bed_id: bed.id, admitting_doctor_id: doc.id,
    department_id: b.department_id ? String(b.department_id) : doc.department_id, bed_request_id: request?.id ?? null,
    reason, deposit_amount: Math.round(deposit * 100) / 100, created_by: c.userId,
  }).select().single();
  if (error) return fail(error.code === "23505" ? "conflict" : "server", error.code === "23505" ? "This patient or bed already has an active admission." : "Could not admit.", error.code === "23505" ? 409 : 500);
  // 2) Occupy the bed only if it's still in the expected state; otherwise undo the admission.
  const { data: occ } = await db.from("beds").update({ status: "occupied", current_admission_id: adm.id, updated_at: now })
    .eq("id", bed.id).eq("status", fromStatus).select("id").maybeSingle();
  if (!occ) {
    await db.from("admissions").delete().eq("id", adm.id);
    return fail("bed_taken", "That bed was just taken. Choose another.", 409);
  }
  // 3) Close the request; release a different reserved bed if one was allotted.
  if (request) {
    if (request.bed_id && request.bed_id !== bed.id) await db.from("beds").update({ status: "free", updated_at: now }).eq("id", request.bed_id).eq("status", "reserved");
    await db.from("bed_requests").update({ status: "admitted", admission_id: adm.id, bed_id: bed.id, updated_at: now }).eq("id", request.id);
  } else {
    await db.from("bed_requests").update({ status: "admitted", admission_id: adm.id, updated_at: now }).eq("patient_id", p.id).eq("status", "pending");
  }
  await audit(db, req, c, "admit", "admission", adm.id, null, adm);
  return json({ ok: true, data: { ...adm, bed_label: bed.label, ward_name: bed.wards.name } });
});
