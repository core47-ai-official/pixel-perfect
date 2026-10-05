// Paste into Supabase → Edge Functions → new function "get-department-patients". Turn "Enforce JWT Verification" OFF.
// dept_head (own department) or admin. Body: { q?, department_id? }. Patients seen by the department's doctors or admitted to it; others are never returned.
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
/** Patient ids seen in this department: appointments/visits with its doctors, or admissions to it. */
async function deptPatientIds(db: DB, H: string, deptId: string, docIds: string[]) {
  const last = new Map<string, { at: string; doctor_id: string | null }>();
  const note = (pid: string, at: string, doctor_id: string | null) => { const e = last.get(pid); if (!e || e.at < at) last.set(pid, { at, doctor_id }); };
  if (docIds.length) {
    const { data: a } = await db.from("appointments").select("patient_id, doctor_id, slot_start").eq("hospital_id", H).in("doctor_id", docIds).neq("status", "cancelled").order("slot_start", { ascending: false }).limit(10000);
    for (const x of a ?? []) note(x.patient_id, x.slot_start, x.doctor_id);
    const { data: v } = await db.from("visits").select("patient_id, doctor_id, created_at").eq("hospital_id", H).in("doctor_id", docIds).order("created_at", { ascending: false }).limit(10000);
    for (const x of v ?? []) note(x.patient_id, x.created_at, x.doctor_id);
  }
  const { data: ad } = await db.from("admissions").select("patient_id, admitting_doctor_id, admitted_at").eq("hospital_id", H).eq("department_id", deptId).order("admitted_at", { ascending: false }).limit(10000);
  for (const x of ad ?? []) note(x.patient_id, x.admitted_at, x.admitting_doctor_id);
  return last;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const s = await deptScope(db, c, b.department_id);
  if ("error" in s) return s.error;
  const H = c.hospitalId;
  const seen = await deptPatientIds(db, H, s.dept.id, s.doctors.map((d) => d.id));
  const myDoc = s.doctors.find((d) => d.user_id === c.userId)?.id ?? null;
  const q = String(b.q ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 60);
  const ids = [...seen.entries()].sort((x, y) => (x[1].at < y[1].at ? 1 : -1)).map(([id]) => id);
  // deno-lint-ignore no-explicit-any
  const found: any[] = [];
  for (let i = 0; i < ids.length && found.length < 100; i += 300) {
    let qq = db.from("patients").select("id, mrn, full_name, dob, gender, phone, cnic").eq("hospital_id", H).is("merged_into", null).in("id", ids.slice(i, i + 300));
    if (q.length >= 2) { const like = `%${q}%`; qq = qq.or([`mrn.ilike.${like}`, `full_name.ilike.${like}`, `cnic.ilike.${like}`, `phone.ilike.${like}`].join(",")); }
    const { data } = await qq;
    found.push(...(data ?? []));
    if (q.length < 2 && found.length >= 100) break;
  }
  const docName = new Map(s.doctors.map((d) => [d.id, d.name]));
  const rows = found.map((p) => {
    const e = seen.get(p.id)!;
    return { ...p, last_seen: e.at, last_doctor: e.doctor_id ? docName.get(e.doctor_id) ?? "" : "", own: !!myDoc && e.doctor_id === myDoc };
  }).sort((x, y) => (x.last_seen < y.last_seen ? 1 : -1)).slice(0, 100);
  return json({ ok: true, data: { department: s.dept, total: ids.length, rows } });
});
