// Paste into Supabase → Edge Functions → new function "search-connectable-doctors". Turn "Enforce JWT Verification" OFF.
// Patient only. Body: { q?: string, code?: string }. Returns verified doctors of the patient's hospital.
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
// deno-lint-ignore no-explicit-any
async function myAccount(db: DB, c: any) {
  if (c.impersonatedBy) return null;
  const { data } = await db.from("patient_accounts").select("id, patient_id, hospital_id, user_id").eq("user_id", c.userId).maybeSingle();
  return data as { id: string; patient_id: string | null; hospital_id: string; user_id: string } | null;
}
// ---- tracker connection helpers (identical in search-connectable-doctors, request-connection, respond-connection, update-connection-permissions, revoke-connection) ----
const PERM_KEYS = ["profile", "conditions", "measurements", "symptoms", "medicines"];
const DEFAULT_PERMS: Record<string, boolean> = { profile: true, conditions: true, measurements: true, symptoms: true, medicines: true };
/** Verified = doctors.verified (staff doctors automatically; outside doctors after admin approval), active login, doctor or outside_doctor role. */
async function verifiedDoctors(db: DB, hospitalId: string, filter: (q: DB) => DB) {
  const { data: docs } = await filter(db.from("doctors").select("id, user_id, specialty, pmdc_no, doctor_code, department_id, departments(name)").eq("hospital_id", hospitalId).eq("verified", true)).limit(30);
  const ids = (docs ?? []).map((d: DB) => d.user_id);
  if (!ids.length) return [];
  const [{ data: profs }, { data: roles }] = await Promise.all([
    db.from("profiles").select("id, full_name, photo_url, is_active").in("id", ids),
    db.from("user_roles").select("user_id").eq("hospital_id", hospitalId).in("role", ["doctor", "outside_doctor"]).in("user_id", ids),
  ]);
  const pm = new Map((profs ?? []).map((p: DB) => [p.id, p]));
  const rs = new Set((roles ?? []).map((r: DB) => r.user_id));
  return (docs ?? []).filter((d: DB) => (pm.get(d.user_id) as DB)?.is_active && rs.has(d.user_id)).map((d: DB) => ({
    id: d.id, user_id: d.user_id, name: (pm.get(d.user_id) as DB).full_name, photo_url: (pm.get(d.user_id) as DB).photo_url,
    specialty: d.specialty, department: d.departments?.name ?? null, doctor_code: d.doctor_code }));
}
async function myDoctor(db: DB, c: DB) {
  const { data } = await db.from("doctors").select("id, user_id, hospital_id, doctor_code").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).maybeSingle();
  return data as { id: string; user_id: string; hospital_id: string; doctor_code: string | null } | null;
}
// ---- end tracker connection helpers ----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const acct = await myAccount(db, c);
  if (!acct) return fail("forbidden", "Only patients can search for doctors.", 403);
  const code = String(b.code ?? "").trim().toUpperCase();
  const q = String(b.q ?? "").trim().toLowerCase().slice(0, 60);
  let list = await verifiedDoctors(db, acct.hospital_id, (x) => code ? x.eq("doctor_code", code) : x);
  if (!code && q) list = list.filter((d: DB) => `${d.name} ${d.specialty} ${d.department ?? ""}`.toLowerCase().includes(q));
  // Codes are only revealed on an exact code match.
  return json({ ok: true, data: list.slice(0, 20).map((d: DB) => ({ ...d, user_id: undefined, doctor_code: code ? d.doctor_code : undefined })) });
});
