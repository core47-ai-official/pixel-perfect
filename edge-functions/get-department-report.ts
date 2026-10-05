// Paste into Supabase → Edge Functions → new function "get-department-report". Turn "Enforce JWT Verification" OFF.
// dept_head (own department) or admin (any; body.department_id). Body: { from, to (YYYY-MM-DD, Pakistan time), department_id? }. OPD per doctor, waiting time, top diagnoses, prescriptions, revenue, no-shows.
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
const r2 = (n: number) => Math.round(n * 100) / 100;
const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const s = await deptScope(db, c, b.department_id);
  if ("error" in s) return s.error;
  const H = c.hospitalId;
  const to = b.to ? new Date(`${String(b.to).slice(0, 10)}T00:00:00${TZ}`) : new Date();
  const toEnd = b.to ? new Date(to.getTime() + 86400e3) : to;
  const from = b.from ? new Date(`${String(b.from).slice(0, 10)}T00:00:00${TZ}`) : new Date(toEnd.getTime() - 30 * 86400e3);
  if (!(from < toEnd) || toEnd.getTime() - from.getTime() > 400 * 86400e3) return fail("bad_range", "Choose a date range of up to one year.");
  const F = from.toISOString(), T = toEnd.toISOString();
  const docIds = s.doctors.map((d) => d.id);
  const per = new Map(s.doctors.map((d) => [d.id, { doctor_id: d.id, name: d.name, specialty: d.specialty, opd: 0, done: 0, no_shows: 0, waits: [] as number[], prescriptions: 0, revenue: 0 }]));
  const diag = new Map<string, { code: string; description: string; count: number }>();
  let unassignedRevenue = 0;

  if (docIds.length) {
    const { data: appts } = await db.from("appointments").select("doctor_id, status, checked_in_at, called_at").eq("hospital_id", H)
      .in("doctor_id", docIds).gte("slot_start", F).lt("slot_start", T).limit(20000);
    for (const a of appts ?? []) {
      const e = per.get(a.doctor_id); if (!e) continue;
      if (a.status === "no_show") e.no_shows++;
      else if (!["cancelled", "needs_rebooking"].includes(a.status)) e.opd++;
      if (a.status === "done") e.done++;
      if (a.checked_in_at && a.called_at) e.waits.push(Math.max(0, (new Date(a.called_at).getTime() - new Date(a.checked_in_at).getTime()) / 60000));
    }
    const { data: rx } = await db.from("prescriptions").select("doctor_id").eq("hospital_id", H).in("doctor_id", docIds).gte("created_at", F).lt("created_at", T).limit(20000);
    for (const x of rx ?? []) { const e = per.get(x.doctor_id); if (e) e.prescriptions++; }
    const { data: visits } = await db.from("visits").select("id").eq("hospital_id", H).in("doctor_id", docIds).gte("created_at", F).lt("created_at", T).limit(20000);
    const vids = (visits ?? []).map((v: { id: string }) => v.id);
    for (let i = 0; i < vids.length; i += 300) {
      const { data: dx } = await db.from("visit_diagnoses").select("icd10_code, description").in("visit_id", vids.slice(i, i + 300));
      for (const d of dx ?? []) {
        const k = d.icd10_code || d.description;
        const e = diag.get(k) ?? { code: d.icd10_code ?? "", description: d.description ?? "", count: 0 };
        e.count++; diag.set(k, e);
      }
    }
  }
  // Revenue: charges posted in the range on bills of this department's visits or admissions.
  const { data: lines } = await db.from("invoice_lines").select("amount, invoices!inner(visits(doctor_id), admissions(department_id, admitting_doctor_id))")
    .eq("hospital_id", H).gte("created_at", F).lt("created_at", T).limit(50000);
  // deno-lint-ignore no-explicit-any
  for (const l of (lines ?? []) as any[]) {
    const inv = l.invoices ?? {};
    const docId: string | null = inv.visits?.doctor_id ?? inv.admissions?.admitting_doctor_id ?? null;
    const inDept = (docId && per.has(docId)) || inv.admissions?.department_id === s.dept.id;
    if (!inDept) continue;
    const e = docId ? per.get(docId) : undefined;
    if (e) e.revenue = r2(e.revenue + Number(l.amount)); else unassignedRevenue = r2(unassignedRevenue + Number(l.amount));
  }
  const doctors = [...per.values()].map(({ waits, ...d }) => ({ ...d, avg_wait_min: avg(waits) })).sort((x, y) => y.opd - x.opd);
  const allWaits = [...per.values()].flatMap((d) => d.waits);
  const totals = {
    opd: doctors.reduce((a, d) => a + d.opd, 0), done: doctors.reduce((a, d) => a + d.done, 0),
    no_shows: doctors.reduce((a, d) => a + d.no_shows, 0), prescriptions: doctors.reduce((a, d) => a + d.prescriptions, 0),
    avg_wait_min: avg(allWaits), revenue: r2(doctors.reduce((a, d) => a + d.revenue, 0) + unassignedRevenue), unassigned_revenue: unassignedRevenue,
  };
  const top_diagnoses = [...diag.values()].sort((x, y) => y.count - x.count).slice(0, 10);
  return json({ ok: true, data: { department: s.dept, from: F, to: T, doctors, totals, top_diagnoses, generated_at: new Date().toISOString() } });
});
