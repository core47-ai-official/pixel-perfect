// Paste into Supabase → Edge Functions → new function "save-health-alert-thresholds". Turn "Enforce JWT Verification" OFF.
// Body: { action: "get" } (admin/super_admin) or { action: "save", values: {...thresholds, enabled, approved_by_doctor} } (super_admin).
// Saving needs the approving doctor's name; the name, who saved and when are stored with the thresholds and audit-logged.
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
// ---- health alert rules (MediCore; identical in check-measurement-alerts and save-health-alert-thresholds, mirrored in src/lib/health-alerts.ts) ----
// Thresholds live in company_settings.health_tracker. They apply only once saved with an approving doctor's name.
const HA_FIELDS: { key: string; type: string; side: "high" | "low"; value: 1 | 2; min: number; max: number }[] = [
  { key: "bp_sys_high", type: "bp", side: "high", value: 1, min: 100, max: 260 },
  { key: "bp_sys_low", type: "bp", side: "low", value: 1, min: 50, max: 120 },
  { key: "bp_dia_high", type: "bp", side: "high", value: 2, min: 60, max: 160 },
  { key: "bp_dia_low", type: "bp", side: "low", value: 2, min: 30, max: 80 },
  { key: "glucose_high", type: "glucose", side: "high", value: 1, min: 120, max: 600 },
  { key: "glucose_low", type: "glucose", side: "low", value: 1, min: 20, max: 100 },
  { key: "temp_high", type: "temp", side: "high", value: 1, min: 37, max: 45 },
  { key: "temp_low", type: "temp", side: "low", value: 1, min: 30, max: 36 },
  { key: "pulse_high", type: "pulse", side: "high", value: 1, min: 80, max: 250 },
  { key: "pulse_low", type: "pulse", side: "low", value: 1, min: 20, max: 70 },
  { key: "spo2_low", type: "spo2", side: "low", value: 1, min: 50, max: 98 },
];
const HA_DEFAULTS: Record<string, number> = { bp_sys_high: 180, bp_sys_low: 90, bp_dia_high: 120, bp_dia_low: 60, glucose_high: 300, glucose_low: 70,
  temp_high: 39, temp_low: 35, pulse_high: 120, pulse_low: 50, spo2_low: 92 };
// deno-lint-ignore no-explicit-any
function alertsFor(m: any, ht: any): { key: string; side: string; threshold: number; value: number }[] {
  if (!ht?.enabled || !String(ht?.approved_by_doctor ?? "").trim()) return [];
  const out = [];
  for (const f of HA_FIELDS) {
    if (f.type !== m.type) continue;
    const th = Number(ht[f.key]);
    if (!Number.isFinite(th) || ht[f.key] === "" || ht[f.key] == null) continue;
    const v = Number(f.value === 1 ? m.value_1 : m.value_2);
    if (!Number.isFinite(v)) continue;
    if ((f.side === "high" && v >= th) || (f.side === "low" && v <= th)) out.push({ key: f.key, side: f.side, threshold: th, value: v });
  }
  return out;
}
// ---- end health alert rules ----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ["admin", "super_admin"])) return fail("forbidden", "Only admins can view these settings.", 403);
  const { data: cs } = await db.from("company_settings").select("id, health_tracker").eq("hospital_id", c.hospitalId).maybeSingle();
  const cur = { enabled: true, ...HA_DEFAULTS, approved_by_doctor: "", ...(cs?.health_tracker ?? {}) };
  if (b.action !== "save") return json({ ok: true, data: { values: cur, can_edit: c.roles.includes("super_admin") } });
  if (!c.roles.includes("super_admin")) return fail("forbidden", "Only the super admin can change these settings.", 403);
  if (!cs) return fail("not_found", "Company settings are missing for this hospital.", 404);
  const v = b.values ?? {};
  const doctor = String(v.approved_by_doctor ?? "").trim().slice(0, 120);
  if (doctor.length < 3) return fail("doctor_required", "Enter the name of the doctor who approved these alert levels.");
  const next: Record<string, unknown> = { enabled: v.enabled !== false, approved_by_doctor: doctor, approved_at: new Date().toISOString(), approved_saved_by: c.userId };
  for (const f of HA_FIELDS) {
    if (v[f.key] === "" || v[f.key] == null) { next[f.key] = null; continue; }
    const n = Number(v[f.key]);
    if (!Number.isFinite(n) || n < f.min || n > f.max) return fail("invalid", `${f.key} must be between ${f.min} and ${f.max}.`);
    next[f.key] = n;
  }
  const pair = (hi: string, lo: string) => next[hi] != null && next[lo] != null && Number(next[lo]) >= Number(next[hi]);
  if (pair("bp_sys_high", "bp_sys_low") || pair("bp_dia_high", "bp_dia_low") || pair("glucose_high", "glucose_low") || pair("temp_high", "temp_low") || pair("pulse_high", "pulse_low"))
    return fail("invalid", "Each low alert level must be below its high alert level.");
  const { error } = await db.from("company_settings").update({ health_tracker: next }).eq("id", cs.id);
  if (error) return fail("server", "Couldn't save the alert levels.", 500);
  await audit(db, req, c, "settings.update_health_tracker", "company_settings", cs.id, cs.health_tracker, next);
  return json({ ok: true, data: { values: next, can_edit: true } });
});
