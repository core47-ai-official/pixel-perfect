// Paste into Supabase → Edge Functions → new function "log-record-view". Turn "Enforce JWT Verification" OFF.
// Any staff. Body: { patient_id }. Audit-logs a department head opening a patient record outside their own list (throttled to once per 30 minutes per patient).
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
// ---- department scope (MediCore; identical in every department function) ----
const ADMIN_ROLES = ["super_admin", "admin"];
/** dept_head → own department (from their dept_head role row); admin → the department they ask for. */
async function deptScope(db: DB, c: { userId: string; hospitalId: string; roles: string[] }, wanted: unknown) {
  const isAdmin = has(c, ADMIN_ROLES);
  let deptId: string | null = null;
  if (isAdmin && wanted && wanted !== "mine") deptId = String(wanted);
  else if (c.roles.includes("dept_head")) {
    const { data } = await db.from("user_roles").select("department_id").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).eq("role", "dept_head").maybeSingle();
    deptId = (data?.department_id as string | undefined) ?? null;
  } else if (isAdmin) return { error: fail("bad_request", "Choose a department.") };
  else return { error: fail("forbidden", "Only department heads and admins can see this.", 403) };
  if (!deptId) return { error: fail("no_department", "You are not assigned to a department yet.") };
  const { data: dept } = await db.from("departments").select("id, name").eq("hospital_id", c.hospitalId).eq("id", deptId).maybeSingle();
  if (!dept) return { error: fail("not_found", "Department not found.", 404) };
  const { data: docs } = await db.from("doctors").select("id, user_id, specialty, status").eq("hospital_id", c.hospitalId).eq("department_id", deptId);
  const uids = (docs ?? []).map((d: { user_id: string }) => d.user_id);
  const { data: profs } = uids.length ? await db.from("profiles").select("id, full_name").in("id", uids) : { data: [] };
  const pn = new Map((profs ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
  // deno-lint-ignore no-explicit-any
  const doctors = (docs ?? []).map((d: any) => ({ id: d.id as string, user_id: d.user_id as string, name: (pn.get(d.user_id) ?? "") as string, specialty: d.specialty as string, status: d.status as string }));
  return { dept: dept as { id: string; name: string }, doctors };
}
// ---- end department scope ---------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  // Only department heads are audited here; admins and other roles already have hospital-wide access by design.
  if (!c.roles.includes("dept_head")) return json({ ok: true, data: { logged: false } });
  const pid = String(b.patient_id ?? "");
  const H = c.hospitalId;
  const { data: p } = await db.from("patients").select("id, mrn").eq("hospital_id", H).eq("id", pid).maybeSingle();
  if (!p) return fail("not_found", "Patient not found.", 404);
  const { data: me } = await db.from("doctors").select("id").eq("hospital_id", H).eq("user_id", c.userId).maybeSingle();
  // "Own list" = patients the caller has personally booked, seen or admitted as a doctor.
  if (me?.id) {
    const own = async (table: string, col: string) => {
      const { count } = await db.from(table).select("id", { count: "exact", head: true }).eq("hospital_id", H).eq("patient_id", pid).eq(col, me.id);
      return (count ?? 0) > 0;
    };
    if (await own("appointments", "doctor_id") || await own("visits", "doctor_id") || await own("admissions", "admitting_doctor_id"))
      return json({ ok: true, data: { logged: false, own: true } });
  }
  const s = await deptScope(db, c, null);
  let inDept = false;
  if (!("error" in s)) {
    const docIds = s.doctors.map((d) => d.id);
    if (docIds.length) {
      const { count } = await db.from("appointments").select("id", { count: "exact", head: true }).eq("hospital_id", H).eq("patient_id", pid).in("doctor_id", docIds);
      inDept = (count ?? 0) > 0;
    }
    if (!inDept) {
      const { count } = await db.from("admissions").select("id", { count: "exact", head: true }).eq("hospital_id", H).eq("patient_id", pid).eq("department_id", s.dept.id);
      inDept = (count ?? 0) > 0;
    }
  }
  // One entry per patient per 30 minutes, so refreshes don't flood the log.
  const since = new Date(Date.now() - 30 * 60000).toISOString();
  const { count: recent } = await db.from("audit_logs").select("id", { count: "exact", head: true }).eq("hospital_id", H).eq("user_id", c.userId)
    .eq("action", "record_view").eq("resource", "patient").eq("resource_id", pid).gte("created_at", since);
  if (!recent) await audit(db, req, c, "record_view", "patient", pid, null, { mrn: p.mrn, in_department: inDept, page: req.headers.get("x-page") ?? null });
  return json({ ok: true, data: { logged: true, in_department: inDept } });
});
