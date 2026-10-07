// Paste into Supabase → Edge Functions → new function "register-outside-doctor". Turn "Enforce JWT Verification" OFF.
// Public. Body: { full_name, specialty, clinic, phone, email, pmdc_no, password, hospital_id?, certificate: { name, type, base64 } }.
// Creates auth user + profile + outside_doctor role + doctors row (verified = false, is_outside = true); certificate goes to private bucket credentials/<hospital_id>/<user_id>/.
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
const PHONE = /^(\+92|0092|92|0)?3\d{9}$/;
const normPhone = (p: string) => "+92" + p.replace(/^(\+92|0092|92|0)/, "");
const MAX = 5 * 1024 * 1024;
function sniff(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method", "POST only.", 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const b = await req.json().catch(() => ({}));
  const full_name = String(b.full_name ?? "").trim().slice(0, 120);
  const specialty = String(b.specialty ?? "").trim().slice(0, 120);
  const clinic = String(b.clinic ?? "").trim().slice(0, 160);
  const email = String(b.email ?? "").trim().toLowerCase();
  const phoneRaw = String(b.phone ?? "").replace(/[\s-]/g, "");
  const pmdc = String(b.pmdc_no ?? "").trim().toUpperCase().slice(0, 30);
  const password = String(b.password ?? "");
  if (full_name.length < 2) return fail("invalid", "Enter your full name.");
  if (!specialty) return fail("invalid", "Enter your speciality.");
  if (!clinic) return fail("invalid", "Enter your clinic or hospital name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("invalid", "Enter a valid email.");
  if (!PHONE.test(phoneRaw)) return fail("invalid", "Enter a valid mobile number, e.g. 03001234567.");
  if (!/^[A-Z0-9-]{3,30}$/.test(pmdc)) return fail("invalid", "Enter your PMDC registration number.");
  if (password.length < 8) return fail("invalid", "Password must be at least 8 characters.");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(String(b.certificate?.base64 ?? "")), (ch) => ch.charCodeAt(0)); } catch { return fail("invalid", "Please attach your PMDC certificate."); }
  if (!bytes.length) return fail("invalid", "Please attach your PMDC certificate.");
  if (bytes.length > MAX) return fail("too_big", "The certificate must be 5 MB or smaller.");
  const ext = sniff(bytes);
  if (!ext) return fail("bad_type", "The certificate must be a PDF, JPG or PNG.");

  let hospitalId = typeof b.hospital_id === "string" ? b.hospital_id : null;
  if (!hospitalId) {
    const { data: hs } = await db.from("hospitals").select("id").eq("is_active", true).limit(2);
    if (hs?.length !== 1) return fail("hospital", "Please sign up from your hospital's link.");
    hospitalId = hs[0].id;
  } else {
    const { data: h } = await db.from("hospitals").select("id").eq("id", hospitalId).eq("is_active", true).maybeSingle();
    if (!h) return fail("hospital", "Hospital not found.");
  }
  const { data: dup } = await db.from("doctors").select("id").eq("hospital_id", hospitalId).eq("pmdc_no", pmdc).maybeSingle();
  if (dup) return fail("taken", "A doctor with this PMDC number is already registered.");

  const { data: created, error } = await db.auth.admin.createUser({ email, email_confirm: true, password, user_metadata: { full_name, portal: "outside_doctor" } });
  if (error || !created?.user) {
    const taken = /already|registered|exists/i.test(error?.message ?? "");
    return fail(taken ? "taken" : "signup_failed", taken ? "An account already exists. Please sign in." : "Could not create the account. Please try again.");
  }
  const uid = created.user.id;
  const path = `${hospitalId}/${uid}/pmdc-${Date.now()}.${ext}`;
  const cleanup = async () => {
    await db.storage.from("credentials").remove([path]);
    await db.from("doctors").delete().eq("user_id", uid);
    await db.from("user_roles").delete().eq("user_id", uid);
    await db.from("profiles").delete().eq("id", uid);
    await db.auth.admin.deleteUser(uid);
  };
  const up = await db.storage.from("credentials").upload(path, bytes, { contentType: ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : "png"}` });
  if (up.error) { await cleanup(); return fail("upload_failed", "Couldn't upload the certificate. Please try again.", 500); }
  const steps = [
    await db.from("profiles").insert({ id: uid, hospital_id: hospitalId, full_name, email, phone: normPhone(phoneRaw), must_change_password: false }),
    await db.from("user_roles").insert({ user_id: uid, hospital_id: hospitalId, role: "outside_doctor" }),
  ];
  const doc = steps.some((s) => s.error) ? null : await db.from("doctors").insert({ hospital_id: hospitalId, user_id: uid, specialty, clinic, pmdc_no: pmdc,
    status: "off_duty", is_outside: true, verified: false, verification_status: "pending", credential_path: path, created_by: uid }).select("id").single();
  if (!doc || doc.error) { await cleanup(); return fail("signup_failed", "Could not create the account. Please try again.", 500); }
  await db.from("audit_logs").insert({ hospital_id: hospitalId, user_id: uid, action: "doctor.register_outside", resource: "doctors", resource_id: doc.data.id, after: { full_name, specialty, clinic, pmdc_no: pmdc } });
  const { data: admins } = await db.from("user_roles").select("user_id").eq("hospital_id", hospitalId).in("role", ["admin", "super_admin"]);
  await queueNotes(db, (admins ?? []).map((a: DB) => ({ hospital_id: hospitalId!, user_id: a.user_id, type: "doctor_verification", title: "Doctor waiting for verification",
    body: `${full_name} (${specialty}, PMDC ${pmdc}) registered and needs verification.`, link: "/doctor-verification", dedupe_key: `docver:${doc.data.id}:${a.user_id}` })));
  return json({ ok: true, data: { user_id: uid, login: email } });
});
