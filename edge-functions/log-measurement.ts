// Paste into Supabase → Edge Functions → new function "log-measurement". Turn "Enforce JWT Verification" OFF.
// Patient only. Body: { type, value_1, value_2?, unit?, context?, measured_at?, notes? }.
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
// ---- measurement rules (MediCore; identical in log-measurement and update-measurement, mirrored in src/lib/measurements.ts) ----
const MG_PER_MMOL = 18.016;
const M_TYPES = ["bp", "glucose", "weight", "temp", "pulse", "spo2", "custom"];
const M_CONTEXTS: Record<string, string[]> = { bp: ["sitting", "standing", "lying"], glucose: ["fasting", "before_meal", "after_meal", "random"] };
const r1 = (n: number) => Math.round(n * 100) / 100;
// deno-lint-ignore no-explicit-any
function checkMeasurement(type: string, b: any): { error: string } | { row: Record<string, unknown> } {
  if (!M_TYPES.includes(type)) return { error: "Unknown measurement type." };
  const v1 = Number(b.value_1), v2 = b.value_2 === null || b.value_2 === undefined || b.value_2 === "" ? null : Number(b.value_2);
  if (!Number.isFinite(v1)) return { error: "Please enter a number." };
  const unitIn = String(b.unit ?? "").trim();
  let value_1 = v1, value_2: number | null = null, unit = unitIn, original_value: number | null = null, original_unit: string | null = null;
  const out = (lo: number, hi: number, label: string, u: string) => `${label} must be between ${lo} and ${hi} ${u}. Please check the reading.`;
  if (type === "bp") {
    if (v2 === null || !Number.isFinite(v2)) return { error: "Enter both the top (systolic) and bottom (diastolic) numbers." };
    if (v1 < 50 || v1 > 260) return { error: out(50, 260, "Systolic (top number)", "mmHg") };
    if (v2 < 30 || v2 > 160) return { error: out(30, 160, "Diastolic (bottom number)", "mmHg") };
    if (v2 >= v1) return { error: "The top number should be higher than the bottom number." };
    value_2 = v2; unit = "mmHg";
  } else if (type === "glucose") {
    if (unitIn === "mmol/L") { original_value = v1; original_unit = "mmol/L"; value_1 = r1(v1 * MG_PER_MMOL); }
    else if (unitIn && unitIn !== "mg/dL") return { error: "Sugar must be in mg/dL or mmol/L." };
    if (value_1 < 20 || value_1 > 600) return { error: unitIn === "mmol/L" ? out(1.1, 33.3, "Sugar", "mmol/L") : out(20, 600, "Sugar", "mg/dL") };
    unit = "mg/dL";
  } else if (type === "weight") {
    if (v1 < 1 || v1 > 400) return { error: out(1, 400, "Weight", "kg") }; unit = "kg";
  } else if (type === "temp") {
    if (unitIn === "°F") { original_value = v1; original_unit = "°F"; value_1 = r1((v1 - 32) * 5 / 9); }
    if (value_1 < 30 || value_1 > 45) return { error: unitIn === "°F" ? out(86, 113, "Temperature", "°F") : out(30, 45, "Temperature", "°C") };
    unit = "°C";
  } else if (type === "pulse") {
    if (v1 < 20 || v1 > 250) return { error: out(20, 250, "Pulse", "beats per minute") }; unit = "bpm";
  } else if (type === "spo2") {
    if (v1 < 50 || v1 > 100) return { error: out(50, 100, "Oxygen (SpO2)", "%") }; unit = "%";
  } else {
    if (!unitIn) return { error: "Enter a unit for this reading." };
    if (Math.abs(v1) > 1e7 || (v2 !== null && (!Number.isFinite(v2) || Math.abs(v2) > 1e7))) return { error: "That number is too large." };
    value_2 = v2; unit = unitIn.slice(0, 20);
  }
  const ctx = b.context ? String(b.context) : null;
  if (ctx && M_CONTEXTS[type] && !M_CONTEXTS[type].includes(ctx)) return { error: "Unknown context." };
  const at = b.measured_at ? new Date(String(b.measured_at)) : new Date();
  if (isNaN(at.getTime())) return { error: "Enter a valid time." };
  if (at.getTime() > Date.now() + 5 * 60_000) return { error: "The time can't be in the future." };
  if (at.getTime() < Date.now() - 5 * 365 * 86400e3) return { error: "The time is too far in the past." };
  return { row: { type, value_1, value_2, unit, original_value, original_unit, context: M_CONTEXTS[type] ? ctx : (ctx ? ctx.slice(0, 40) : null),
    measured_at: at.toISOString(), notes: String(b.notes ?? "").trim().slice(0, 1000) || null } };
}
async function myAccount(db: DB, c: { userId: string; roles: string[]; impersonatedBy: string | null }) {
  if (!c.roles.includes("patient") || c.impersonatedBy) return null;
  const { data } = await db.from("patient_accounts").select("id, patient_id").eq("user_id", c.userId).maybeSingle();
  return data as { id: string; patient_id: string | null } | null;
}
// ---- end measurement rules ----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const acct = await myAccount(db, c);
  if (!acct) return fail("forbidden", "Only patients can log their own readings.", 403);
  const chk = checkMeasurement(String(b.type ?? ""), b);
  if ("error" in chk) return fail("out_of_range", chk.error);
  const { data, error } = await db.from("measurements").insert({ ...chk.row, patient_account_id: acct.id, patient_id: acct.patient_id }).select().single();
  if (error) return fail("server", "Couldn't save the reading.", 500);
  // Informational alerts (never a diagnosis): check-measurement-alerts compares with the hospital's approved thresholds.
  let alerts: unknown[] = []; let hospital_phone: string | null = null;
  try {
    const h: Record<string, string> = { "Content-Type": "application/json", Authorization: req.headers.get("Authorization") ?? "" };
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/check-measurement-alerts`, { method: "POST", headers: h, body: JSON.stringify({ measurement_id: data.id }) });
    const j = await r.json().catch(() => null);
    if (j?.ok && Array.isArray(j.data?.alerts)) { alerts = j.data.alerts; hospital_phone = j.data.hospital_phone ?? null; }
  } catch (_) { /* the reading is saved either way */ }
  return json({ ok: true, data: { ...data, alerts, hospital_phone } });
});
