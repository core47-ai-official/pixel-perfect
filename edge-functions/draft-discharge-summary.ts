// Paste into Supabase → Edge Functions → new function "draft-discharge-summary". Turn "Enforce JWT Verification" OFF.
// Body: { admission_id, ...fields? }. Creates the summary prefilled from the stay (visits, diagnoses, OT notes, active prescriptions) if none exists; saves edits while not finalized; returns the summary.
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
const CLIN = ["super_admin", "admin", "dept_head", "doctor"];
const READ = [...CLIN, "nurse"];
const s = (v: unknown, max = 4000) => { const t = String(v ?? "").trim().slice(0, max); return t || null; };
const FIELDS = ["diagnosis", "procedures", "course", "condition_at_discharge", "advice_en", "advice_ur"] as const;
/** Cleans editable fields from the request body (only keys that are present). */
// deno-lint-ignore no-explicit-any
function editable(b: any): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) if (f in b) out[f] = s(b[f]);
  if ("follow_up_date" in b) {
    const d = s(b.follow_up_date, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return "Follow-up date is not valid.";
    out.follow_up_date = d;
  }
  if ("medicines" in b) {
    if (!Array.isArray(b.medicines)) return "Medicines list is not valid.";
    out.medicines = b.medicines.slice(0, 50).map((m: Record<string, unknown>) => ({
      name: s(m?.name, 200) ?? "", dose: s(m?.dose, 100), frequency: s(m?.frequency, 50), duration_days: Number(m?.duration_days) > 0 ? Math.min(365, Math.round(Number(m.duration_days))) : null,
      instructions_en: s(m?.instructions_en, 500), instructions_ur: s(m?.instructions_ur, 500),
    })).filter((m: { name: string }) => m.name);
  }
  return out;
}
// deno-lint-ignore no-explicit-any
async function prefill(db: DB, adm: any) {
  const since = adm.admitted_at;
  const { data: visits } = await db.from("visits").select("id, chief_complaint, plan, created_at").eq("hospital_id", adm.hospital_id).eq("patient_id", adm.patient_id).gte("created_at", since).order("created_at");
  const vIds = (visits ?? []).map((v: { id: string }) => v.id);
  const { data: dx } = vIds.length ? await db.from("visit_diagnoses").select("icd10_code, description, is_primary").in("visit_id", vIds) : { data: [] };
  const seen = new Set<string>();
  const diagnosis = (dx ?? []).sort((a: { is_primary: boolean }, b: { is_primary: boolean }) => Number(b.is_primary) - Number(a.is_primary))
    .filter((d: { icd10_code: string }) => !seen.has(d.icd10_code) && seen.add(d.icd10_code))
    .map((d: { icd10_code: string; description: string }) => `${d.icd10_code} ${d.description}`).join("\n") || adm.reason || null;
  const { data: ots } = await db.from("ot_bookings").select("id, procedure, actual_start, planned_start, status").eq("hospital_id", adm.hospital_id).eq("patient_id", adm.patient_id).eq("status", "completed").gte("planned_start", since).order("planned_start");
  const otIds = (ots ?? []).map((o: { id: string }) => o.id);
  const { data: notes } = otIds.length ? await db.from("operation_notes").select("booking_id, findings, complications").in("booking_id", otIds) : { data: [] };
  const procedures = (ots ?? []).map((o: { id: string; procedure: string; actual_start: string | null; planned_start: string }) => {
    const n = (notes ?? []).find((x: { booking_id: string }) => x.booking_id === o.id);
    const day = String(o.actual_start ?? o.planned_start).slice(0, 10);
    return [`${day}: ${o.procedure}`, n?.findings ? `  Findings: ${n.findings}` : "", n?.complications ? `  Complications: ${n.complications}` : ""].filter(Boolean).join("\n");
  }).join("\n") || null;
  const course = [`Admitted ${String(since).slice(0, 10)}${adm.reason ? ` for ${adm.reason}` : ""}.`,
    ...(visits ?? []).filter((v: { plan: string | null }) => v.plan).map((v: { created_at: string; plan: string }) => `${v.created_at.slice(0, 10)}: ${v.plan}`)].join("\n");
  const { data: rx } = await db.from("prescriptions").select("id, status").eq("hospital_id", adm.hospital_id).eq("patient_id", adm.patient_id).gte("created_at", since).neq("status", "cancelled");
  const rxIds = (rx ?? []).map((r: { id: string }) => r.id);
  const { data: items } = rxIds.length ? await db.from("prescription_items").select("medicine_name, dose, frequency, duration_days, instructions_en, instructions_ur, created_at").in("prescription_id", rxIds).order("created_at", { ascending: false }) : { data: [] };
  const names = new Set<string>();
  const medicines = (items ?? []).filter((i: { medicine_name: string }) => !names.has(i.medicine_name) && names.add(i.medicine_name))
    .map((i: Record<string, unknown>) => ({ name: i.medicine_name, dose: i.dose, frequency: i.frequency, duration_days: i.duration_days, instructions_en: i.instructions_en, instructions_ur: i.instructions_ur }));
  return { diagnosis, procedures, course, medicines };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, READ)) return fail("forbidden", "You can't open discharge summaries.", 403);
  const { data: adm } = await db.from("admissions").select("*").eq("id", String(b.admission_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!adm) return fail("not_found", "Admission not found.", 404);
  let { data: sum } = await db.from("discharge_summaries").select("*").eq("admission_id", adm.id).maybeSingle();
  const fields = editable(b);
  if (typeof fields === "string") return fail("invalid", fields);
  const wantsEdit = Object.keys(fields).length > 0;
  if (wantsEdit && !has(c, CLIN)) return fail("forbidden", "Only doctors can write the discharge summary.", 403);
  if (!sum) {
    if (adm.status !== "admitted" && !wantsEdit) return json({ ok: true, data: null });
    const pre = await prefill(db, adm);
    const ins = await db.from("discharge_summaries").insert({ hospital_id: c.hospitalId, admission_id: adm.id, patient_id: adm.patient_id, ...pre,
      written_by: has(c, CLIN) ? c.userId : null, created_by: c.userId }).select().maybeSingle();
    if (ins.error) { // created by someone else at the same moment
      sum = (await db.from("discharge_summaries").select("*").eq("admission_id", adm.id).maybeSingle()).data;
      if (!sum) return fail("error", "Could not create the summary.", 500);
    } else sum = ins.data;
  }
  if (wantsEdit) {
    if (sum.finalized_at) return fail("locked", "This summary is finalized and can't be changed.", 409);
    const { data: upd, error } = await db.from("discharge_summaries").update({ ...fields, written_by: c.userId, updated_at: new Date().toISOString() })
      .eq("id", sum.id).is("finalized_at", null).select().maybeSingle();
    if (error || !upd) return fail("locked", "This summary was just finalized.", 409);
    sum = upd;
  }
  return json({ ok: true, data: sum });
});
