// Paste into Supabase → Edge Functions → new function "register-emergency". Turn "Enforce JWT Verification" OFF.
// ER officer / receptionist / admin. Body: { patient_id? | new_patient: { full_name?, gender, age_years?, phone? , is_unknown? }, complaint, arrival_mode?, triage_color? }. No payment step.
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
const ER_ROLES = ["super_admin", "admin", "er_officer", "receptionist", "doctor", "nurse", "dept_head"];
const COLORS = ["red", "orange", "yellow", "green"];
// deno-lint-ignore no-explicit-any
async function openCase(db: DB, hospitalId: string, id: unknown): Promise<any> {
  const { data } = await db.from("emergency_cases").select("*").eq("id", String(id ?? "")).eq("hospital_id", hospitalId).maybeSingle();
  return data;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ["super_admin", "admin", "er_officer", "receptionist"])) return fail("forbidden", "You can't register emergency patients.", 403);
  const complaint = String(b.complaint ?? "").trim().slice(0, 500);
  if (complaint.length < 2) return fail("invalid", "Enter the main complaint.");
  let patientId: string | null = null;
  if (b.patient_id) {
    const { data: p } = await db.from("patients").select("id").eq("id", String(b.patient_id)).eq("hospital_id", c.hospitalId).maybeSingle();
    if (!p) return fail("not_found", "Patient not found.", 404);
    patientId = p.id;
  } else {
    const np = b.new_patient ?? {};
    const unknown = !!np.is_unknown || !String(np.full_name ?? "").trim();
    const gender = ["male", "female", "other"].includes(np.gender) ? np.gender : null;
    if (!gender) return fail("invalid", "Choose gender.");
    const age = Number(np.age_years);
    let dob: string | null = null;
    if (Number.isFinite(age) && age >= 0 && age <= 120) dob = `${new Date().getFullYear() - Math.round(age)}-01-01`;
    const phone = String(np.phone ?? "").replace(/[^\d+]/g, "").slice(0, 15) || null;
    let mrn = "";
    for (let i = 0; i < 8 && !mrn; i++) {
      const { data: k } = await db.from("counters").select("id, next_value").eq("hospital_id", c.hospitalId).eq("key", "mrn").maybeSingle();
      if (!k) { await db.from("counters").insert({ hospital_id: c.hospitalId, key: "mrn", prefix: "MRN-", next_value: 1, reset_rule: "never" }); continue; }
      const { data: won } = await db.from("counters").update({ next_value: k.next_value + 1, updated_at: new Date().toISOString() })
        .eq("id", k.id).eq("next_value", k.next_value).select("id");
      if (won?.length) mrn = `MRN-${new Date().getFullYear()}-${String(k.next_value).padStart(6, "0")}`;
    }
    if (!mrn) return fail("counter", "Couldn't assign an MRN, please try again.", 500);
    const stamp = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
    const { data: p, error } = await db.from("patients").insert({
      hospital_id: c.hospitalId, mrn, full_name: unknown ? `Unknown ${gender === "female" ? "female" : "male"} ${stamp}` : String(np.full_name).trim().slice(0, 120),
      gender, dob, phone, is_unknown: unknown, allergies: [], chronic_conditions: [], print_language: "ur", created_by: c.userId,
    }).select("id").single();
    if (error) return fail("server", "Could not create the patient.", 500);
    patientId = p.id;
    await audit(db, req, c, "create", "patient", p.id, null, { mrn, is_unknown: unknown, via: "emergency" });
  }
  const color = COLORS.includes(b.triage_color) ? b.triage_color : null;
  const now = new Date().toISOString();
  const { data, error } = await db.from("emergency_cases").insert({
    hospital_id: c.hospitalId, patient_id: patientId, complaint, arrival_mode: ["walk_in", "ambulance", "police", "referred"].includes(b.arrival_mode) ? b.arrival_mode : "walk_in",
    triage_color: color, triaged_at: color ? now : null, triaged_by: color ? c.userId : null, created_by: c.userId,
  }).select("*, patients(id, mrn, full_name)").single();
  if (error) return fail(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? "This patient already has an open emergency case." : "Could not save.", error.code === "23505" ? 409 : 500);
  await audit(db, req, c, "create", "emergency_case", data.id, null, data);
  return json({ ok: true, data });
});
