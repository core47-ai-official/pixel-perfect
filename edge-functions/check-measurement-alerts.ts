// Paste into Supabase → Edge Functions → new function "check-measurement-alerts". Turn "Enforce JWT Verification" OFF.
// Patient only (log-measurement calls it with the patient's token). Body: { measurement_id }.
// Returns informational alerts only — never a diagnosis. Notifies connected doctors who can see measurements (non-urgent).
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
// ---- notification helpers (identical wherever they appear; mirrors src/config/notification-types.ts) ----
// Every event notification goes through queueNotes: it applies the hospital's English/Urdu template for the type
// (company settings → notifications → tpl_<type>_<en|ur>, first line = title, rest = body, {placeholders} from vars),
// picks the recipient's language (patient print language, otherwise staff UI language), skips non-critical types the
// recipient turned off, and ignores duplicates by dedupe_key. Critical types can never be turned off.
const NOTE_CRITICAL = ["critical_result", "ot_bumped"];
const NOTE_DEFAULTS: Record<string, { en: string; ur: string }> = {
  appointment_booked: { en: "Appointment confirmed\n{doctor} · {date} {time} · Token {token}", ur: "اپائنٹمنٹ کنفرم\n{doctor} · {date} {time} · ٹوکن {token}" },
  appointment_reminder: { en: "Appointment reminder\nYou see {doctor} on {date} at {time} (token {token}).", ur: "اپائنٹمنٹ یاد دہانی\n{date} کو {time} بجے {doctor} سے ملاقات ہے (ٹوکن {token})۔" },
  appointment_cancelled: { en: "Appointment cancelled\n{doctor} · {date} {time}. {reason}", ur: "اپائنٹمنٹ منسوخ\n{doctor} · {date} {time}۔ {reason}" },
  appointment_rescheduled: { en: "Appointment rescheduled\nNew time: {doctor} · {date} {time} · Token {token}", ur: "اپائنٹمنٹ کا وقت تبدیل\nنیا وقت: {doctor} · {date} {time} · ٹوکن {token}" },
  report_ready: { en: "Lab report ready\n{test} report for {patient} is ready.", ur: "لیب رپورٹ تیار\n{patient} کی {test} رپورٹ تیار ہے۔" },
  critical_result: { en: "URGENT: critical result — {patient}\n{test} (MRN {mrn}): {values}", ur: "فوری: خطرناک نتیجہ — {patient}\n{test} (ایم آر این {mrn}): {values}" },
  leave_decision: { en: "Leave {status}\n{from} to {to}. {note}", ur: "چھٹی {status}\n{from} سے {to}۔ {note}" },
  approval_decision: { en: "{kind} request {status}\n{invoice} · Rs {amount}. {note}", ur: "{kind} درخواست {status}\n{invoice} · روپے {amount}۔ {note}" },
  ot_bumped: { en: "Your OT case was moved for an emergency\n{procedure}: {reason}", ur: "ایمرجنسی کی وجہ سے آپ کا آپریشن منتقل ہوا\n{procedure}: {reason}" },
  stock_low: { en: "{count} medicine(s) below reorder level\n{items}", ur: "{count} ادویات ری آرڈر حد سے کم\n{items}" },
  followup_due: { en: "Follow-up visit tomorrow\nPlease visit the hospital on {date} for your follow-up after discharge.", ur: "کل فالو اپ معائنہ\nڈسچارج کے بعد فالو اپ کے لیے {date} کو ہسپتال تشریف لائیں۔" },
  dose_reminder: { en: "Time for your medicine\n{medicine} {dose} — whenever you are ready, tap to mark it.", ur: "دوا کا وقت\n{medicine} {dose} — جب آپ تیار ہوں، نشان لگانے کے لیے ٹیپ کریں۔" },
  home_reading_alert: { en: "Home reading outside alert level\n{patient}: {measure} {reading} on {date} {time}. For information.", ur: "گھریلو ریڈنگ الرٹ حد سے باہر\n{patient}: {measure} {reading}، {date} {time}۔ معلومات کے لیے۔" },
};
const NOTE_WORDS: Record<string, Record<string, string>> = {
  ur: { approved: "منظور", rejected: "نامنظور", discount: "رعایت", waiver: "معافی", refund: "واپسی", reversal: "منسوخی" },
};
/** Maps legacy/variant type names to their preference category. */
const noteCategory = (type: string) => type.startsWith("leave_") ? "leave_decision" : type.startsWith("approval_") ? "approval_decision" : type === "followup_reminder" ? "followup_due" : type;
const fillNote = (tpl: string, vars: Record<string, unknown>, lang: string) =>
  tpl.replace(/\{(\w+)\}/g, (_m, k) => { const v = vars[k]; if (v == null) return ""; const s = String(v); return NOTE_WORDS[lang]?.[s] ?? s; }).replace(/\s+([.،۔])\s*$/g, "$1").trim();
const notePkDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric" });
const notePkTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit" });
interface NoteIn {
  hospital_id: string; user_id: string; type: string; title?: string; body?: string; link?: string | null; created_by?: string | null;
  channel?: string; scheduled_at?: string | null; dedupe_key?: string | null; vars?: Record<string, unknown>;
}
// deno-lint-ignore no-explicit-any
async function queueNotes(db: any, input: NoteIn | NoteIn[]): Promise<{ error: unknown; count: number }> {
  const rows = (Array.isArray(input) ? input : [input]).filter((r) => r && r.user_id);
  if (!rows.length) return { error: null, count: 0 };
  const hospitalId = rows[0].hospital_id;
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const [{ data: cs }, { data: prefs }, { data: profs }, { data: pats }] = await Promise.all([
    db.from("company_settings").select("notifications, localization").eq("hospital_id", hospitalId).maybeSingle(),
    db.from("notification_preferences").select("user_id, disabled_types").in("user_id", ids),
    db.from("profiles").select("id, preferences").in("id", ids),
    db.from("patients").select("user_id, print_language").in("user_id", ids),
  ]);
  const cfg = (cs?.notifications ?? {}) as Record<string, unknown>;
  const defLang = String(cs?.localization?.default_language ?? "en");
  const off = new Map<string, string[]>((prefs ?? []).map((p: { user_id: string; disabled_types: string[] }) => [p.user_id, p.disabled_types ?? []]));
  const langOf = (u: string) => {
    const pt = (pats ?? []).find((p: { user_id: string }) => p.user_id === u);
    if (pt) return pt.print_language === "ur" ? "ur" : "en";
    const pr = (profs ?? []).find((p: { id: string }) => p.id === u);
    const l = pr?.preferences?.language ?? defLang;
    return l === "ur" ? "ur" : "en";
  };
  const out = [];
  for (const r of rows) {
    const cat = noteCategory(r.type);
    const critical = NOTE_CRITICAL.includes(cat);
    if (!critical && (off.get(r.user_id) ?? []).includes(cat)) continue;
    let title = r.title ?? "", body = r.body ?? "";
    if (r.vars) {
      const lang = langOf(r.user_id);
      const tpl = String(cfg[`tpl_${cat}_${lang}`] || "") || (lang === "ur" ? String(cfg[`tpl_${cat}_en`] || "") || NOTE_DEFAULTS[cat]?.ur : String(cfg[`tpl_${cat}_en`] || "") || NOTE_DEFAULTS[cat]?.en) || "";
      if (tpl) {
        const [t1, ...rest] = fillNote(tpl, r.vars, lang).split("\n");
        title = t1.trim() || title; body = rest.join("\n").trim() || body;
      }
    }
    out.push({ hospital_id: r.hospital_id, user_id: r.user_id, type: r.type, channel: r.channel ?? "push", title: title.slice(0, 200), body: body.slice(0, 1000),
      link: r.link ?? null, created_by: r.created_by ?? null, scheduled_at: r.scheduled_at ?? null, dedupe_key: r.dedupe_key ?? null, priority: critical ? "critical" : "normal" });
  }
  if (!out.length) return { error: null, count: 0 };
  const { error } = await db.from("notifications").upsert(out, { onConflict: "dedupe_key", ignoreDuplicates: true });
  return { error, count: error ? 0 : out.length };
}
// ---- end notification helpers ----
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
const READ = (m: { type: string; value_1: number; value_2: number | null; unit: string }) => m.type === "bp" ? `${m.value_1}/${m.value_2} mmHg` : `${m.value_1} ${m.unit}`;
const LABEL: Record<string, string> = { bp: "Blood pressure", glucose: "Sugar", temp: "Temperature", pulse: "Pulse", spo2: "Oxygen (SpO2)" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!c.roles.includes("patient") || c.impersonatedBy) return fail("forbidden", "Only patients can check their own readings.", 403);
  const { data: acct } = await db.from("patient_accounts").select("id, patient_id").eq("user_id", c.userId).maybeSingle();
  if (!acct) return fail("forbidden", "Only patients can check their own readings.", 403);
  const { data: m } = await db.from("measurements").select("*").eq("id", String(b.measurement_id ?? "")).eq("patient_account_id", acct.id).is("deleted_at", null).maybeSingle();
  if (!m) return fail("not_found", "Reading not found.", 404);
  const { data: cs } = await db.from("company_settings").select("health_tracker").eq("hospital_id", c.hospitalId).maybeSingle();
  const alerts = alertsFor(m, cs?.health_tracker ?? {});
  let notified = 0;
  if (alerts.length) {
    const { data: cns } = await db.from("connections").select("id, doctor_id, patient_name, permissions").eq("patient_account_id", acct.id).eq("status", "active");
    const ids = (cns ?? []).filter((x: { permissions: Record<string, boolean> }) => x.permissions?.measurements === true).map((x: { doctor_id: string }) => x.doctor_id);
    if (ids.length) {
      const { data: docs } = await db.from("doctors").select("id, user_id").in("id", ids);
      const notes = (docs ?? []).filter((d: { user_id: string | null }) => d.user_id).map((d: { id: string; user_id: string }) => {
        const cn = (cns ?? []).find((x: { doctor_id: string }) => x.doctor_id === d.id);
        return { hospital_id: c.hospitalId, user_id: d.user_id, type: "home_reading_alert", link: "/tracker-connections",
          title: "Home reading outside alert level", body: `${cn?.patient_name ?? "A patient"}: ${LABEL[m.type] ?? m.type} ${READ(m)}`,
          vars: { patient: cn?.patient_name ?? "A patient", measure: LABEL[m.type] ?? m.type, reading: READ(m), date: notePkDate(m.measured_at), time: notePkTime(m.measured_at) },
          dedupe_key: `halert:${m.id}:${d.user_id}` };
      });
      notified = (await queueNotes(db, notes)).count;
    }
    await audit(db, req, c, "tracker.health_alert", "measurements", m.id, null, { alerts, notified });
  }
  return json({ ok: true, data: { alerts, notified } });
});
