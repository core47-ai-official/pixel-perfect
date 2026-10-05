// Paste into Supabase → Edge Functions → new function "save-dashboard-layout". Turn "Enforce JWT Verification" OFF.
// Body: { dashboard, widgets: [{id,size}] }. Max 12; only widgets the caller's roles allow.
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
};
const DEFAULT_LAYOUTS: Record<string, { id: string; size: string }[]> = {
  super_admin: [{ id: "active_users", size: "small" }, { id: "errors_today", size: "small" }, { id: "bed_occupancy", size: "small" }, { id: "opd_today", size: "small" }, { id: "adm_dis_trend", size: "wide" }],
  admin: [{ id: "bed_occupancy", size: "small" }, { id: "opd_today", size: "small" }, { id: "er_waiting", size: "small" }, { id: "cash_vs_unpaid", size: "small" }, { id: "adm_dis_trend", size: "wide" }],
  receptionist: [{ id: "token_queue", size: "medium" }, { id: "appointments_today", size: "small" }, { id: "walk_ins", size: "small" }, { id: "no_shows", size: "small" }],
  doctor: [{ id: "my_queue", size: "medium" }, { id: "waiting_patients", size: "small" }, { id: "my_admitted", size: "medium" }, { id: "critical_results", size: "medium" }],
  nurse: [{ id: "ward_beds", size: "medium" }, { id: "vitals_due", size: "medium" }],
  cashier: [{ id: "shift_cash", size: "small" }, { id: "pending_bills", size: "small" }, { id: "deposits_summary", size: "small" }],
  er_officer: [{ id: "er_waiting", size: "small" }, { id: "bed_occupancy", size: "small" }],
  dept_head: [{ id: "opd_today", size: "small" }, { id: "bed_occupancy", size: "small" }, { id: "adm_dis_trend", size: "wide" }],
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
  const b = await req.json().catch(() => ({}));
  const dashboard = String(b.dashboard ?? "home").slice(0, 40);
  if (!Array.isArray(b.widgets)) return fail("invalid", "Widgets list is missing.");
  if (b.widgets.length > MAX_WIDGETS) return fail("invalid", `At most ${MAX_WIDGETS} widgets.`);
  const widgets = cleanLayout(b.widgets, c.roles)!;
  if (widgets.length !== b.widgets.length) return fail("forbidden", "One or more widgets aren't available for your role.", 403);
  const { data: prev } = await db.from("dashboard_layouts").select("*").eq("user_id", c.userId).eq("dashboard", dashboard).maybeSingle();
  const { data, error } = await db.from("dashboard_layouts").upsert({ hospital_id: c.hospitalId, user_id: c.userId, dashboard, widgets,
    updated_at: new Date().toISOString(), created_by: c.userId }, { onConflict: "user_id,dashboard" }).select().single();
  if (error) return fail("server", "Could not save the layout.", 500);
  await audit(db, req, c, "dashboard.save", "dashboard_layouts", data.id, prev, data);
  return json({ ok: true, data });
});
