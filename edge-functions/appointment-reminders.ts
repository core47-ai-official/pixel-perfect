// Paste into Supabase → Edge Functions → new function "appointment-reminders". Turn "Enforce JWT Verification" OFF.
// Scheduled every 15 minutes by Supabase Cron (see appointment-reminders.cron.sql), header x-cron-key = CRON_SECRET.
// For each hospital and each reminder timing in company settings (notifications.reminder_first_hours / reminder_second_hours,
// default 24 and 2; 0 = off) it queues a reminder for booked appointments of patients with an app account, scheduled for
// exactly <hours> before the slot (process-notifications sends it when due). Each reminder is queued once (dedupe key per
// appointment, timing and slot), so reruns and overlaps are harmless. A reminder whose time had already passed when the
// appointment was booked is skipped, unless it was due within the last 15 minutes (it then goes out at once).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page, x-cron-key",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
// deno-lint-ignore no-explicit-any
type DB = any;
const cronOk = (req: Request) => { const s = Deno.env.get("CRON_SECRET"); return !!s && req.headers.get("x-cron-key") === s; };

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
const LOOKAHEAD_MIN = 30; // queue a bit ahead so a 15-minute run never misses the exact time
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!cronOk(req)) return fail("forbidden", "Not allowed.", 403);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const nowMs = Date.now();
  const { data: hospitals } = await db.from("hospitals").select("id");
  const out = [];
  for (const h of hospitals ?? []) {
    const { data: cs } = await db.from("company_settings").select("notifications").eq("hospital_id", h.id).maybeSingle();
    const cfg = cs?.notifications ?? {};
    const timings = [...new Set([cfg.reminder_first_hours ?? 24, cfg.reminder_second_hours ?? 2].map(Number).filter((x) => x > 0 && x <= 168))];
    let queued = 0;
    for (const hrs of timings) {
      const until = new Date(nowMs + hrs * 3600e3 + LOOKAHEAD_MIN * 60e3).toISOString();
      const { data: appts } = await db.from("appointments").select("id, patient_id, doctor_id, slot_start, token_no, created_at")
        .eq("hospital_id", h.id).eq("status", "booked").gt("slot_start", new Date(nowMs).toISOString()).lte("slot_start", until).limit(1000);
      const list = (appts ?? []).filter((a: { slot_start: string; created_at: string }) => {
        const due = Date.parse(a.slot_start) - hrs * 3600e3;
        if (due < nowMs - 15 * 60e3) return false;                         // reminder time is long gone
        return due >= Date.parse(a.created_at) - 15 * 60e3;               // booked before (or right around) the reminder time
      });
      if (!list.length) continue;
      const pIds = [...new Set(list.map((a: { patient_id: string }) => a.patient_id))];
      const dIds = [...new Set(list.map((a: { doctor_id: string }) => a.doctor_id))];
      const [{ data: pts }, { data: docs }] = await Promise.all([
        db.from("patients").select("id, user_id, full_name").in("id", pIds).not("user_id", "is", null),
        db.from("doctors").select("id, user_id").in("id", dIds),
      ]);
      const { data: dprof } = await db.from("profiles").select("id, full_name").in("id", (docs ?? []).map((d: { user_id: string }) => d.user_id));
      const docName = (id: string) => { const d = (docs ?? []).find((x: { id: string }) => x.id === id); return (dprof ?? []).find((p: { id: string }) => p.id === d?.user_id)?.full_name ?? "Doctor"; };
      const rows: NoteIn[] = [];
      for (const a of list) {
        const p = (pts ?? []).find((x: { id: string }) => x.id === a.patient_id);
        if (!p?.user_id) continue;
        const due = Math.max(Date.parse(a.slot_start) - hrs * 3600e3, nowMs);
        rows.push({ hospital_id: h.id, user_id: p.user_id, type: "appointment_reminder", link: "/my-appointments",
          title: "Appointment reminder", body: `${docName(a.doctor_id)} · ${notePkDate(a.slot_start)} ${notePkTime(a.slot_start)} · Token ${a.token_no}`,
          vars: { patient: p.full_name, doctor: docName(a.doctor_id), date: notePkDate(a.slot_start), time: notePkTime(a.slot_start), token: a.token_no, hours: hrs },
          scheduled_at: new Date(due).toISOString(), dedupe_key: `appt:${a.id}:remind:${hrs}h:${a.slot_start}` });
      }
      for (let i = 0; i < rows.length; i += 200) queued += (await queueNotes(db, rows.slice(i, i + 200))).count;
    }
    out.push({ hospital_id: h.id, timings, queued });
  }
  return json({ ok: true, data: out });
});
