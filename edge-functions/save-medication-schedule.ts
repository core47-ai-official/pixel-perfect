// Paste into Supabase → Edge Functions → new function "save-medication-schedule". Turn "Enforce JWT Verification" OFF.
// Patient only. Body: { id?, name, dose?, times["HH:MM"], start_date?, end_date?, instructions?, active? }.
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
// ---- dose plan (identical in sync-prescriptions-to-tracker, save-medication-schedule, generate-dose-events, log-dose) ----
// Clock times are Pakistan time "HH:MM". 1+0+1 → 08:00, 20:00; OD/BD/TDS/QID/HS same hours as the ward MAR.
const PK = 5 * 3600e3;
const SLOTS: Record<string, string[]> = { OD: ["08:00"], BD: ["08:00", "20:00"], TDS: ["08:00", "14:00", "20:00"], QID: ["08:00", "12:00", "16:00", "20:00"], HS: ["21:00"] };
/** [] = as needed, null = once now. */
function timesFor(freq: string): string[] | null {
  const f = String(freq ?? "").trim().toUpperCase();
  if (f === "SOS" || f === "PRN") return [];
  if (f === "STAT") return null;
  if (SLOTS[f]) return SLOTS[f];
  const parts = f.split("+");
  if (parts.length >= 2 && parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
    const pos = parts.length === 4 ? SLOTS.QID : parts.length === 3 ? SLOTS.TDS : SLOTS.BD;
    return parts.map((p, i) => (Number(p) > 0 ? pos[i] : "")).filter(Boolean);
  }
  return SLOTS.OD;
}
const pkDay = (ms: number) => new Date(ms + PK).toISOString().slice(0, 10);
const validTime = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
/** Dose instants at/after fromMs, sorted; stops at count or untilMs (whichever first). */
function nextSlots(times: string[], fromMs: number, count: number | null, untilMs: number | null): number[] {
  const mins = [...new Set(times)].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))).sort((a, b) => a - b);
  const out: number[] = [];
  if (!mins.length) return out;
  const day0 = Date.parse(`${pkDay(fromMs)}T00:00:00Z`) - PK;
  for (let d = 0; d < 400; d++) for (const m of mins) {
    const at = day0 + d * 86400e3 + m * 60e3;
    if (at < fromMs) continue;
    if (untilMs !== null && at > untilMs) return out;
    out.push(at);
    if (count !== null && out.length >= count) return out;
  }
  return out;
}
// ---- end dose plan ----
// deno-lint-ignore no-explicit-any
async function myAccount(db: DB, c: any) {
  if (c.impersonatedBy) return null;
  const { data } = await db.from("patient_accounts").select("id, patient_id").eq("user_id", c.userId).maybeSingle();
  return data as { id: string; patient_id: string | null } | null;
}
const clip = (v: unknown, n: number) => (v == null ? null : String(v).trim().slice(0, n) || null);
const isDay = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const acct = await myAccount(db, c);
  if (!acct) return fail("forbidden", "Only patients can change their own medicines.", 403);
  const nowMs = Date.now();
  // deno-lint-ignore no-explicit-any
  let before: any = null;
  if (b.id) {
    const { data } = await db.from("medication_schedules").select("*").eq("id", String(b.id)).eq("patient_account_id", acct.id).maybeSingle();
    if (!data) return fail("not_found", "Medicine not found.", 404);
    before = data;
  }
  // deno-lint-ignore no-explicit-any
  let row: any;
  if (before?.source === "hospital") {
    // A doctor's course: the patient can only pause or resume it.
    row = { active: b.active !== false };
  } else {
    const name = clip(b.name, 120);
    if (!name) return fail("invalid", "Please enter the medicine name.");
    const times = Array.isArray(b.times) ? [...new Set(b.times as unknown[])] : [];
    if (!times.length || times.length > 6 || !times.every(validTime)) return fail("invalid", "Please choose 1 to 6 times of day.");
    const start = isDay(b.start_date) ? b.start_date : pkDay(nowMs);
    const end = isDay(b.end_date) ? b.end_date : null;
    if (end && end < start) return fail("invalid", "The end date is before the start date.");
    row = { name, dose: clip(b.dose, 60), instructions: clip(b.instructions, 300), times: (times as string[]).sort(), start_date: start, end_date: end,
      active: b.active !== false, source: "patient" };
  }
  const q = before
    ? db.from("medication_schedules").update(row).eq("id", before.id).select().single()
    : db.from("medication_schedules").insert({ ...row, patient_account_id: acct.id, patient_id: acct.patient_id }).select().single();
  const { data: saved, error } = await q;
  if (error) return fail("server", "Couldn't save the medicine.", 500);
  if (before?.source !== "hospital" || !saved.active) {
    // Re-plan future unlogged doses (hospital courses keep their counted doses unless paused).
    await db.from("dose_events").delete().eq("schedule_id", saved.id).is("status", null).gte("due_at", new Date(nowMs).toISOString());
  }
  if (saved.active && saved.source === "patient") {
    const from = Math.max(nowMs, Date.parse(`${saved.start_date}T00:00:00Z`) - PK);
    const until = Math.min(nowMs + 24 * 3600e3, saved.end_date ? Date.parse(`${saved.end_date}T23:59:59Z`) - PK : Infinity);
    const slots = nextSlots(saved.times, from, null, until);
    if (slots.length) await db.from("dose_events").insert(slots.map((at) => ({ schedule_id: saved.id, patient_account_id: acct.id, patient_id: acct.patient_id, due_at: new Date(at).toISOString() })));
  }
  await audit(db, req, c, before ? "update" : "create", "medication_schedule", saved.id, before, saved);
  return json({ ok: true, data: saved });
});
