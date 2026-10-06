// Paste into Supabase → Edge Functions → new function "save-role-dashboards". Turn "Enforce JWT Verification" OFF.
// super_admin. Body: { role, widgets: [{id,size}] | null }. Sets that role's default dashboard (null = back to built-in default).
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
// Widget ids + roles: must mirror src/config/widgets.tsx.
const WIDGET_ROLES: Record<string, string[]> = {
  active_users: ["super_admin", "admin"],
  errors_today: ["super_admin"],
  bed_occupancy: ["super_admin", "admin", "nurse", "dept_head", "receptionist", "er_officer"],
  opd_today: ["super_admin", "admin", "dept_head"],
  er_waiting: ["super_admin", "admin", "er_officer", "dept_head"],
  cash_vs_unpaid: ["super_admin", "admin"],
  surge_watch: ["super_admin", "admin"],
  adm_dis_trend: ["super_admin", "admin", "dept_head"],
  token_queue: ["super_admin", "admin", "receptionist"],
  appointments_today: ["super_admin", "admin", "receptionist"],
  walk_ins: ["super_admin", "admin", "receptionist"],
  no_shows: ["super_admin", "admin", "receptionist"],
  my_queue: ["doctor"],
  waiting_patients: ["doctor"],
  my_admitted: ["doctor"],
  critical_results: ["doctor"],
  ward_beds: ["nurse"],
  vitals_due: ["nurse"],
  shift_cash: ["cashier", "admin", "super_admin"],
  pending_bills: ["cashier", "admin", "super_admin"],
  deposits_summary: ["cashier", "admin", "super_admin"],
  dept_opd_by_doctor: ["dept_head"],
  dept_waiting_now: ["dept_head"],
  dept_admissions: ["dept_head"],
  dept_top_diagnoses: ["dept_head"],
  dept_revenue: ["dept_head"],
  dept_on_leave: ["dept_head"],
  my_duty: ["super_admin", "admin", "dept_head", "doctor", "nurse", "er_officer", "ot_coordinator", "receptionist", "pharmacist", "lab_tech", "cashier"],
};
const DEFAULT_LAYOUTS: Record<string, { id: string; size: string }[]> = {
  super_admin: [{ id: "active_users", size: "small" }, { id: "errors_today", size: "small" }, { id: "bed_occupancy", size: "small" }, { id: "opd_today", size: "small" }, { id: "adm_dis_trend", size: "wide" }],
  admin: [{ id: "bed_occupancy", size: "small" }, { id: "opd_today", size: "small" }, { id: "er_waiting", size: "small" }, { id: "cash_vs_unpaid", size: "small" }, { id: "adm_dis_trend", size: "wide" }],
  receptionist: [{ id: "token_queue", size: "medium" }, { id: "appointments_today", size: "small" }, { id: "walk_ins", size: "small" }, { id: "no_shows", size: "small" }],
  doctor: [{ id: "my_queue", size: "medium" }, { id: "waiting_patients", size: "small" }, { id: "my_admitted", size: "medium" }, { id: "critical_results", size: "medium" }],
  nurse: [{ id: "ward_beds", size: "medium" }, { id: "vitals_due", size: "medium" }],
  cashier: [{ id: "shift_cash", size: "small" }, { id: "pending_bills", size: "small" }, { id: "deposits_summary", size: "small" }],
  er_officer: [{ id: "er_waiting", size: "small" }, { id: "bed_occupancy", size: "small" }],
  dept_head: [{ id: "dept_opd_by_doctor", size: "medium" }, { id: "dept_waiting_now", size: "small" }, { id: "dept_revenue", size: "small" }, { id: "dept_admissions", size: "small" }, { id: "dept_on_leave", size: "medium" }, { id: "dept_top_diagnoses", size: "medium" }],
};
const SIZES = ["small", "medium", "wide"];
const MAX_WIDGETS = 12;
// deno-lint-ignore no-explicit-any
function cleanLayout(items: any, roles: string[]) {
  if (!Array.isArray(items)) return null;
  const seen = new Set<string>();
  const out: { id: string; size: string }[] = [];
  for (const w of items) {
    const id = String(w?.id ?? ""); const size = SIZES.includes(w?.size) ? w.size : "small";
    const allowed = WIDGET_ROLES[id];
    if (!allowed || seen.has(id) || !roles.some((r) => allowed.includes(r))) continue;
    seen.add(id); out.push({ id, size });
  }
  return out.slice(0, MAX_WIDGETS);
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.includes("super_admin")) return fail("forbidden", "Only the super admin can set default dashboards.", 403);
  const b = await req.json().catch(() => ({}));
  const role = String(b.role ?? "");
  if (!DEFAULT_LAYOUTS[role] && role !== "pharmacist" && role !== "lab_tech" && role !== "ot_coordinator") return fail("invalid", "Unknown role.");
  const { data: cs } = await db.from("company_settings").select("id, dashboards").eq("hospital_id", c.hospitalId).single();
  const next = { ...(cs.dashboards ?? {}) };
  if (b.widgets === null) delete next[role];
  else {
    if (!Array.isArray(b.widgets) || b.widgets.length > MAX_WIDGETS) return fail("invalid", `At most ${MAX_WIDGETS} widgets.`);
    const list = cleanLayout(b.widgets, [role])!;
    if (list.length !== b.widgets.length) return fail("invalid", "Some widgets aren't available for that role.");
    next[role] = list;
  }
  const { error } = await db.from("company_settings").update({ dashboards: next, updated_at: new Date().toISOString() }).eq("id", cs.id);
  if (error) return fail("server", "Could not save.", 500);
  await audit(db, req, c, "settings.dashboards", "company_settings", cs.id, { [role]: cs.dashboards?.[role] ?? null }, { [role]: next[role] ?? null });
  return json({ ok: true, data: { dashboards: next } });
});
