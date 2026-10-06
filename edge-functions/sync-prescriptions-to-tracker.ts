// Paste into Supabase → Edge Functions → new function "sync-prescriptions-to-tracker". Turn "Enforce JWT Verification" OFF.
// Called by save-prescription. Body: { prescription_id }. Linked patients only; plans the whole course as dose events.
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
const ROLES = ["super_admin", "admin", "dept_head", "doctor"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ROLES)) return fail("forbidden", "Not allowed.", 403);
  const { data: rx } = await db.from("prescriptions").select("id, patient_id, created_at").eq("id", String(b.prescription_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!rx) return fail("not_found", "Prescription not found.", 404);
  const { data: acct } = await db.from("patient_accounts").select("id, patient_id").eq("hospital_id", c.hospitalId).eq("patient_id", rx.patient_id).maybeSingle();
  if (!acct) return json({ ok: true, data: { skipped: "not_linked", doses: 0 } });
  const [{ data: items }, { data: existing }] = await Promise.all([
    db.from("prescription_items").select("*").eq("prescription_id", rx.id).order("sort_order"),
    db.from("medication_schedules").select("*").eq("prescription_id", rx.id),
  ]);
  const nowMs = Date.now(), nowIso = new Date(nowMs).toISOString();
  const byName = new Map((existing ?? []).map((s: { name: string }) => [s.name.toLowerCase(), s]));
  const keep = new Set<string>();
  let doses = 0;
  for (const it of items ?? []) {
    const name = String(it.medicine_name ?? "").trim();
    if (!name) continue;
    const times = timesFor(String(it.frequency ?? ""));
    const days = Math.min(Math.max(Number(it.duration_days) || 7, 1), 90);
    const fields = { name, dose: it.dose ?? null, frequency: it.frequency ?? null, duration_days: days, rx_item_id: it.id,
      instructions: [it.instructions_en, it.instructions_ur].filter(Boolean).join(" · ") || null, times: times ?? [], active: true,
      source: "hospital", prescription_id: rx.id, patient_account_id: acct.id, patient_id: acct.patient_id };
    // deno-lint-ignore no-explicit-any
    let sched: any = byName.get(name.toLowerCase());
    if (sched) {
      const { data, error } = await db.from("medication_schedules").update(fields).eq("id", sched.id).select().single();
      if (error) return fail("server", "Couldn't update the tracker medicines.", 500);
      sched = data;
    } else {
      const { data, error } = await db.from("medication_schedules").insert({ ...fields, start_date: pkDay(nowMs) }).select().single();
      if (error) return fail("server", "Couldn't add the tracker medicines.", 500);
      sched = data;
    }
    keep.add(sched.id);
    // Rebuild only future, not-yet-logged doses; doses already due or logged count toward the course.
    await db.from("dose_events").delete().eq("schedule_id", sched.id).is("status", null).gte("due_at", nowIso);
    const { count: done } = await db.from("dose_events").select("id", { count: "exact", head: true }).eq("schedule_id", sched.id);
    let slots: number[] = [];
    if (times === null) slots = (done ?? 0) > 0 ? [] : [nowMs];
    else slots = nextSlots(times, nowMs, Math.max(days * times.length - (done ?? 0), 0), null);
    if (slots.length) {
      const { error } = await db.from("dose_events").insert(slots.map((at) => ({ schedule_id: sched.id, patient_account_id: acct.id, patient_id: acct.patient_id, due_at: new Date(at).toISOString() })));
      if (error) return fail("server", "Couldn't create the dose reminders.", 500);
      await db.from("medication_schedules").update({ end_date: pkDay(slots[slots.length - 1]) }).eq("id", sched.id);
    }
    doses += slots.length;
  }
  // Medicines removed from the prescription stop; their history stays.
  for (const s of existing ?? []) if (!keep.has(s.id)) {
    await db.from("medication_schedules").update({ active: false }).eq("id", s.id);
    await db.from("dose_events").delete().eq("schedule_id", s.id).is("status", null).gte("due_at", nowIso);
  }
  await audit(db, req, c, "sync", "tracker_medicines", rx.id, null, { patient_account_id: acct.id, doses });
  return json({ ok: true, data: { doses, medicines: keep.size } });
});
