// Paste into Supabase → Edge Functions → new function "set-target-range". Turn "Enforce JWT Verification" OFF.
// Doctor only. Body: { patient_id, type, low?, high?, low_2?, high_2? } and/or { patient_id, followup_on: 'YYYY-MM-DD' | null }. Needs an active connection.
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
// ---- doctor ↔ patient link (identical in get-home-readings and set-target-range) ----
async function myDoctor(db: DB, c: DB) {
  const { data } = await db.from("doctors").select("id, user_id, hospital_id").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).maybeSingle();
  return data as { id: string; user_id: string; hospital_id: string } | null;
}
/** The active connection between this doctor and the hospital patient, or null. Never reveals whether the patient has an account. */
async function activeLink(db: DB, doctorId: string, hospitalId: string, patientId: string) {
  const { data: pa } = await db.from("patient_accounts").select("id, user_id, hospital_id").eq("patient_id", patientId).eq("hospital_id", hospitalId).maybeSingle();
  if (!pa) return null;
  const { data: cn } = await db.from("connections").select("*").eq("patient_account_id", pa.id).eq("doctor_id", doctorId).eq("status", "active").maybeSingle();
  return cn ? { account: pa, conn: cn } : null;
}
const allowed = (cn: DB, k: string) => cn?.permissions?.[k] !== false && cn?.permissions?.[k] !== "false";
// ---- end link ----
const TYPES = ["bp", "glucose", "weight", "temp", "pulse", "spo2"];
const num = (v: unknown) => v === null || v === "" || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : NaN;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const doc = await myDoctor(db, c);
  if (!doc) return fail("forbidden", "Only doctors can set targets.", 403);
  const link = await activeLink(db, doc.id, c.hospitalId, String(b.patient_id ?? ""));
  if (!link) return fail("not_connected", "This patient isn't sharing home data with you.", 403);
  const out: Record<string, unknown> = {};
  if (b.type !== undefined) {
    if (!allowed(link.conn, "measurements")) return fail("not_shared", "The patient isn't sharing measurements with you.", 403);
    const type = String(b.type);
    if (!TYPES.includes(type)) return fail("invalid", "Unknown measure.");
    const t = { low: num(b.low), high: num(b.high), low_2: type === "bp" ? num(b.low_2) : null, high_2: type === "bp" ? num(b.high_2) : null };
    if (Object.values(t).some((x) => Number.isNaN(x))) return fail("invalid", "Please enter numbers only.");
    if ((t.low != null && t.high != null && t.low >= t.high) || (t.low_2 != null && t.high_2 != null && t.low_2 >= t.high_2)) return fail("invalid", "The low value must be below the high value.");
    const { data: prof } = await db.from("tracker_profiles").select("id, targets").eq("patient_account_id", link.account.id).maybeSingle();
    if (!prof) return fail("no_profile", "The patient hasn't finished setting up their health tracker yet.", 409);
    const before = prof.targets ?? {};
    const targets = { ...before };
    if (Object.values(t).every((x) => x == null)) delete targets[type]; else targets[type] = { ...t, set_by: doc.id, set_at: new Date().toISOString() };
    const { error } = await db.from("tracker_profiles").update({ targets, updated_at: new Date().toISOString() }).eq("id", prof.id);
    if (error) return fail("failed", "Couldn't save the target.", 500);
    await audit(db, req, c, "tracker.set_target", "tracker_profiles", prof.id, { [type]: before[type] ?? null }, { [type]: targets[type] ?? null });
    out.targets = targets;
  }
  if (b.followup_on !== undefined) {
    const f = b.followup_on ? String(b.followup_on) : null;
    const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
    if (f && (!/^\d{4}-\d{2}-\d{2}$/.test(f) || f <= today)) return fail("invalid", "Choose a follow-up date after today.");
    const { error } = await db.from("connections").update({ followup_on: f, updated_at: new Date().toISOString() }).eq("id", link.conn.id).eq("status", "active");
    if (error) return fail("failed", "Couldn't save the follow-up date.", 500);
    await audit(db, req, c, "tracker.set_followup", "connections", link.conn.id, { followup_on: link.conn.followup_on }, { followup_on: f });
    if (f) {
      // Reminder at 09:00 Pakistan time the day before (or right away if that has passed).
      const at = Math.max(Date.parse(`${f}T09:00:00+05:00`) - 86400e3, Date.now());
      await queueNotes(db, { hospital_id: c.hospitalId, user_id: link.account.user_id, type: "followup_due", link: "/portal/book",
        scheduled_at: new Date(at).toISOString(), dedupe_key: `conn-fu:${link.conn.id}:${f}`, vars: { date: notePkDate(`${f}T09:00:00+05:00`), patient: "" } });
      await queueNotes(db, { hospital_id: c.hospitalId, user_id: doc.user_id, type: "followup_due", title: "Patient follow-up due",
        body: `A tracker patient's follow-up is on ${f}.`, link: "/tracker-connections", scheduled_at: new Date(at).toISOString(), dedupe_key: `conn-fu-doc:${link.conn.id}:${f}` });
    }
    out.followup_on = f;
  }
  return json({ ok: true, data: out });
});
