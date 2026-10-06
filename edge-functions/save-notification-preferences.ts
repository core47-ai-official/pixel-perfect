// Paste into Supabase → Edge Functions → new function "save-notification-preferences". Turn "Enforce JWT Verification" OFF.
// Any signed-in user. Body: { disabled_types: string[] }. Saves which non-critical alert types the caller turned off.
// Critical types (critical_result, ot_bumped) are always removed from the list, so they can never be turned off.
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
const TYPES = ["appointment_booked", "appointment_reminder", "appointment_cancelled", "appointment_rescheduled", "appointment_needs_rebooking", "dose_reminder",
  "report_ready", "leave_decision", "approval_decision", "stock_low", "stock_expiring", "followup_due", "critical_result", "ot_bumped"];
const CRITICAL = ["critical_result", "ot_bumped"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (c.impersonatedBy) return fail("forbidden", "You can't change someone else's notification settings while acting as them.", 403);
  const list = Array.isArray(b.disabled_types) ? [...new Set<string>(b.disabled_types.map(String))] : null;
  if (!list) return fail("invalid", "Send the list of turned-off types.");
  const disabled = list.filter((t) => TYPES.includes(t) && !CRITICAL.includes(t));
  const now = new Date().toISOString();
  const { data, error } = await db.from("notification_preferences").upsert({ user_id: c.userId, hospital_id: c.hospitalId, disabled_types: disabled, updated_at: now, created_by: c.userId }, { onConflict: "user_id" }).select().single();
  if (error) return fail("server", "Could not save your settings.", 500);
  return json({ ok: true, data });
});
