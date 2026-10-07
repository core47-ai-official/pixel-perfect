// Paste into Supabase → Edge Functions → new function "clear-demo-data". Turn "Enforce JWT Verification" OFF.
// super_admin only. Removes every demo row recorded in demo_rows (and anything staff later added against demo patients/users).
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
// ---- demo data helpers (identical in seed-demo-data and clear-demo-data) ----
// Every demo row id is recorded in demo_rows (table_name, row_id); demo auth users under table_name "auth.users".
// Clearing deletes children first, also removing rows staff later added against demo patients/users, so nothing real is touched.
const chunk = <T,>(a: T[], n = 150) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
async function demoIds(db: DB, h: string, table: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("demo_rows").select("row_id").eq("hospital_id", h).eq("table_name", table).range(from, from + 999);
    out.push(...(data ?? []).map((r: { row_id: string }) => r.row_id));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function delIn(db: DB, table: string, col: string, ids: string[], errs: string[]) {
  for (const part of chunk(ids)) {
    const { error } = await db.from(table).delete().in(col, part);
    if (error && !/does not exist|schema cache/i.test(error.message)) errs.push(`${table}.${col}: ${error.message}`);
  }
}
async function clearDemo(db: DB, h: string): Promise<{ removed: number; errors: string[] }> {
  const errs: string[] = [];
  const ids: Record<string, string[]> = {};
  for (const t of ["patients", "patient_accounts", "visits", "appointments", "admissions", "invoices", "prescriptions", "orders", "doctors", "departments", "wards", "beds",
    "lab_tests", "medicines", "tariffs", "counters", "cashier_shifts", "doctor_schedules", "auth.users", "measurements", "tracker_profiles", "connections"])
    ids[t] = await demoIds(db, h, t);
  const P = ids.patients, PA = ids.patient_accounts, U = ids["auth.users"];
  const removed = Object.values(ids).reduce((s, a) => s + a.length, 0);
  // tracker
  for (const t of ["measurements", "symptom_logs", "dose_events", "medication_schedules", "tracker_conditions", "tracker_profiles", "health_report_shares", "connections"])
    await delIn(db, t, "patient_account_id", PA, errs);
  await delIn(db, "health_report_shares", "patient_id", P, errs);
  await delIn(db, "feedback", "patient_id", P, errs);
  // money
  await delIn(db, "payments", "patient_id", P, errs);
  await delIn(db, "deposits", "patient_id", P, errs);
  await delIn(db, "installment_plans", "patient_id", P, errs);
  await delIn(db, "unpaid_followups", "patient_id", P, errs);
  await delIn(db, "approvals", "patient_id", P, errs);
  await delIn(db, "welfare_transactions", "patient_id", P, errs);
  const invIds = [...ids.invoices];
  for (const part of chunk(P)) { const { data } = await db.from("invoices").select("id").in("patient_id", part); invIds.push(...(data ?? []).map((r: { id: string }) => r.id)); }
  await delIn(db, "invoice_lines", "invoice_id", invIds, errs);
  await delIn(db, "invoices", "id", invIds, errs);
  // clinical
  await delIn(db, "dispensations", "patient_id", P, errs);
  const rxIds = [...ids.prescriptions];
  for (const part of chunk(P)) { const { data } = await db.from("prescriptions").select("id").in("patient_id", part); rxIds.push(...(data ?? []).map((r: { id: string }) => r.id)); }
  await delIn(db, "med_administrations", "patient_id", P, errs);
  await delIn(db, "prescription_items", "prescription_id", rxIds, errs);
  await delIn(db, "prescriptions", "id", rxIds, errs);
  const ordIds = [...ids.orders];
  for (const part of chunk(P)) { const { data } = await db.from("orders").select("id").in("patient_id", part); ordIds.push(...(data ?? []).map((r: { id: string }) => r.id)); }
  await delIn(db, "lab_result_values", "order_id", ordIds, errs);
  await delIn(db, "orders", "id", ordIds, errs);
  await delIn(db, "blood_requests", "patient_id", P, errs);
  await delIn(db, "referrals", "patient_id", P, errs);
  await delIn(db, "discharge_summaries", "patient_id", P, errs);
  await delIn(db, "vitals", "patient_id", P, errs);
  const visIds = [...ids.visits];
  for (const part of chunk(P)) { const { data } = await db.from("visits").select("id").in("patient_id", part); visIds.push(...(data ?? []).map((r: { id: string }) => r.id)); }
  await delIn(db, "visit_diagnoses", "visit_id", visIds, errs);
  await delIn(db, "visit_addenda", "visit_id", visIds, errs);
  await delIn(db, "visits", "id", visIds, errs);
  await delIn(db, "ot_bookings", "patient_id", P, errs);
  await delIn(db, "emergency_cases", "patient_id", P, errs);
  await delIn(db, "bed_requests", "patient_id", P, errs);
  for (const part of chunk(P)) {
    const { data } = await db.from("admissions").select("id").in("patient_id", part);
    const a = (data ?? []).map((r: { id: string }) => r.id);
    if (a.length) await db.from("beds").update({ status: "free", current_admission_id: null }).in("current_admission_id", a);
  }
  await delIn(db, "admissions", "patient_id", P, errs);
  await delIn(db, "appointments", "patient_id", P, errs);
  await delIn(db, "patient_link_codes", "patient_id", P, errs);
  await delIn(db, "patient_entitlements", "patient_id", P, errs);
  await delIn(db, "patient_accounts", "id", PA, errs);
  await delIn(db, "patients", "id", P, errs);
  // set-up data
  await delIn(db, "cashier_shifts", "id", ids.cashier_shifts, errs);
  await delIn(db, "beds", "id", ids.beds, errs);
  await delIn(db, "wards", "id", ids.wards, errs);
  await delIn(db, "doctor_schedules", "doctor_id", ids.doctors, errs);
  await delIn(db, "doctor_leaves", "doctor_id", ids.doctors, errs);
  for (const part of chunk(ids.doctors)) await db.from("departments").update({ head_doctor_id: null }).in("head_doctor_id", part);
  await delIn(db, "connections", "doctor_id", ids.doctors, errs);
  await delIn(db, "doctors", "id", ids.doctors, errs);
  await delIn(db, "departments", "id", ids.departments, errs);
  await delIn(db, "lab_tests", "id", ids.lab_tests, errs);
  await delIn(db, "medicines", "id", ids.medicines, errs);
  await delIn(db, "tariffs", "id", ids.tariffs, errs);
  await delIn(db, "counters", "id", ids.counters, errs);
  // users
  for (const t of ["roster_shifts", "notifications", "notification_preferences", "push_subscriptions", "dashboard_layouts", "audit_logs", "error_logs"])
    await delIn(db, t, "user_id", U, errs);
  await delIn(db, "roster_shifts", "staff_id", U, errs);
  await delIn(db, "user_roles", "user_id", U, errs);
  await delIn(db, "profiles", "id", U, errs);
  for (const u of U) { const { error } = await db.auth.admin.deleteUser(u); if (error && !/not found/i.test(error.message)) errs.push(`user ${u}: ${error.message}`); }
  if (!errs.length) await db.from("demo_rows").delete().eq("hospital_id", h);
  return { removed, errors: errs.slice(0, 20) };
}
// ---- end demo data helpers ----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!c.roles.includes("super_admin") || c.impersonatedBy) return fail("forbidden", "Only the super admin can clear demo data.", 403);
  const r = await clearDemo(db, c.hospitalId);
  await audit(db, req, c, "demo.clear", "hospitals", c.hospitalId, null, r);
  if (r.errors.length) return fail("partial", `Some demo records could not be removed: ${r.errors[0]}`, 500);
  return json({ ok: true, data: r });
});
