// Paste into Supabase → Edge Functions → new function "log-dose". Turn "Enforce JWT Verification" OFF.
// Patient only. Body: { dose_event_id, action: taken | skipped | snooze }.
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
// deno-lint-ignore no-explicit-any
async function myAccount(db: DB, c: any) {
  if (c.impersonatedBy) return null;
  const { data } = await db.from("patient_accounts").select("id, patient_id, hospital_id, user_id").eq("user_id", c.userId).maybeSingle();
  return data as { id: string; patient_id: string | null; hospital_id: string; user_id: string } | null;
}
const SNOOZE_MS = 15 * 60e3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const acct = await myAccount(db, c);
  if (!acct) return fail("forbidden", "Only patients can log their own doses.", 403);
  const action = String(b.action ?? "");
  if (!["taken", "skipped", "snooze"].includes(action)) return fail("invalid", "Unknown action.");
  const { data: ev } = await db.from("dose_events").select("*, medication_schedules(name, dose)").eq("id", String(b.dose_event_id ?? "")).eq("patient_account_id", acct.id).maybeSingle();
  if (!ev) return fail("not_found", "Dose not found.", 404);
  const nowMs = Date.now(), due = Date.parse(ev.due_at);
  if (due > nowMs + 2 * 3600e3) return fail("too_early", "This dose isn't due yet.");
  if (action === "snooze") {
    if (ev.status) return fail("already", "This dose is already marked.");
    const until = new Date(nowMs + SNOOZE_MS).toISOString();
    const { data, error } = await db.from("dose_events").update({ snoozed_until: until, reminded_at: new Date(nowMs).toISOString() }).eq("id", ev.id).is("status", null).select().maybeSingle();
    if (error || !data) return fail("conflict", "This dose was just updated. Please refresh.", 409);
    await queueNotes(db, { hospital_id: acct.hospital_id, user_id: acct.user_id, type: "dose_reminder", link: "/portal/medicines", scheduled_at: until,
      dedupe_key: `dose:${ev.id}:${until}`, vars: { medicine: ev.medication_schedules?.name ?? "", dose: ev.medication_schedules?.dose ?? "", time: notePkTime(until) } });
    return json({ ok: true, data });
  }
  // Taken/skipped: open or missed doses can be marked, up to a day late.
  if (ev.status && ev.status !== "missed") return fail("already", "This dose is already marked.");
  if (nowMs - due > 24 * 3600e3) return fail("too_late", "This dose is more than a day old.");
  let q = db.from("dose_events").update({ status: action, logged_at: new Date(nowMs).toISOString() }).eq("id", ev.id);
  q = ev.status ? q.eq("status", ev.status) : q.is("status", null);
  const { data, error } = await q.select().maybeSingle();
  if (error || !data) return fail("conflict", "This dose was just updated. Please refresh.", 409);
  return json({ ok: true, data });
});
