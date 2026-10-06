// Paste into Supabase → Edge Functions → new function "attach-report-to-appointment". Turn "Enforce JWT Verification" OFF.
// Patient only. Body: { appointment_id, from, to }. Saves a snapshot of the report for that appointment's doctor (one per appointment, replaced on re-attach).
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
// ---- health report builder (identical in generate-health-report and attach-report-to-appointment) ----
const RPK = 5 * 3600e3;
const isYmd = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** Range check: valid Pakistan dates, from ≤ to ≤ today, at most 366 days. */
function reportRange(from: unknown, to: unknown): { error: string } | { from: string; to: string; fromIso: string; toIso: string } {
  if (!isYmd(from) || !isYmd(to)) return { error: "Please choose a start and end date." };
  const f = Date.parse(`${from}T00:00:00Z`), t = Date.parse(`${to}T00:00:00Z`);
  if (t < f) return { error: "The end date is before the start date." };
  if ((t - f) / 86400e3 > 366) return { error: "Please choose a range of one year or less." };
  return { from: from as string, to: to as string, fromIso: new Date(f - RPK).toISOString(), toIso: new Date(t + 86400e3 - RPK).toISOString() };
}
// deno-lint-ignore no-explicit-any
async function buildReport(db: DB, acct: { id: string; patient_id: string | null }, r: { from: string; to: string; fromIso: string; toIso: string }) {
  const [{ data: prof }, { data: pt }, { data: conds }, { data: scheds }, { data: doses }, { data: readings }, { data: symptoms }] = await Promise.all([
    db.from("tracker_profiles").select("height_cm, weight_kg, blood_group, health_status, targets").eq("patient_account_id", acct.id).maybeSingle(),
    acct.patient_id ? db.from("patients").select("full_name, mrn, dob, gender, print_language").eq("id", acct.patient_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("tracker_conditions").select("name, status, onset_date").eq("patient_account_id", acct.id).order("name"),
    db.from("medication_schedules").select("id, name, dose, times, source, active, start_date, end_date").eq("patient_account_id", acct.id).order("name"),
    db.from("dose_events").select("schedule_id, status").eq("patient_account_id", acct.id).gte("due_at", r.fromIso).lt("due_at", r.toIso),
    db.from("measurements").select("type, value_1, value_2, measured_at").eq("patient_account_id", acct.id).is("deleted_at", null)
      .gte("measured_at", r.fromIso).lt("measured_at", r.toIso).order("measured_at"),
    db.from("symptom_logs").select("symptom, severity, started_at").eq("patient_account_id", acct.id).is("deleted_at", null)
      .gte("started_at", r.fromIso).lt("started_at", r.toIso).order("started_at"),
  ]);
  // deno-lint-ignore no-explicit-any
  const medicines = (scheds ?? []).map((s: any) => {
    const ev = (doses ?? []).filter((d: { schedule_id: string }) => d.schedule_id === s.id);
    const n = (st: string) => ev.filter((d: { status: string | null }) => d.status === st).length;
    return { name: s.name, dose: s.dose, times: s.times ?? [], source: s.source, active: s.active, taken: n("taken"), skipped: n("skipped"), missed: n("missed") };
  }).filter((m: { active: boolean; taken: number; skipped: number; missed: number }) => m.active || m.taken + m.skipped + m.missed > 0);
  return {
    from: r.from, to: r.to, generated_at: new Date().toISOString(),
    patient: pt ?? null, profile: prof ? { height_cm: prof.height_cm, weight_kg: prof.weight_kg, blood_group: prof.blood_group, health_status: prof.health_status } : null,
    targets: prof?.targets ?? {}, conditions: conds ?? [], medicines, readings: readings ?? [], symptoms: symptoms ?? [],
  };
}
// deno-lint-ignore no-explicit-any
async function myAccount(db: DB, c: any) {
  // Patient caller; a super_admin only while acting as the patient.
  const { data } = await db.from("patient_accounts").select("id, patient_id, hospital_id").eq("user_id", c.userId).maybeSingle();
  return data as { id: string; patient_id: string | null; hospital_id: string } | null;
}
// ---- end health report builder ----
const OPEN = ["booked", "waiting", "checked_in", "needs_rebooking"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const acct = await myAccount(db, c);
  if (!acct?.patient_id) return fail("forbidden", "Link your hospital record first.", 403);
  const r = reportRange(b.from, b.to);
  if ("error" in r) return fail("invalid", r.error);
  const { data: appt } = await db.from("appointments").select("id, patient_id, doctor_id, hospital_id, slot_start, status")
    .eq("id", String(b.appointment_id ?? "")).eq("patient_id", acct.patient_id).maybeSingle();
  if (!appt) return fail("not_found", "Appointment not found.", 404);
  if (!OPEN.includes(appt.status) || Date.parse(appt.slot_start) < Date.now() - 3600e3) return fail("closed", "You can only attach a report to an upcoming appointment.");
  const report = await buildReport(db, acct, r);
  const { data: before } = await db.from("health_report_shares").select("id, date_from, date_to").eq("appointment_id", appt.id).maybeSingle();
  const row = { hospital_id: appt.hospital_id, patient_account_id: acct.id, patient_id: acct.patient_id, appointment_id: appt.id, doctor_id: appt.doctor_id,
    date_from: r.from, date_to: r.to, report, updated_at: new Date().toISOString() };
  const { data, error } = await db.from("health_report_shares").upsert(row, { onConflict: "appointment_id" }).select("id, appointment_id, date_from, date_to, created_at").single();
  if (error) return fail("server", "Couldn't attach the report.", 500);
  await audit(db, req, { ...c, hospitalId: appt.hospital_id }, before ? "update" : "create", "health_report_share", data.id, before, { appointment_id: appt.id, date_from: r.from, date_to: r.to });
  return json({ ok: true, data });
});
