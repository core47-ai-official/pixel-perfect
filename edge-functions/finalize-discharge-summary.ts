// Paste into Supabase → Edge Functions → new function "finalize-discharge-summary". Turn "Enforce JWT Verification" OFF.
// Body: { admission_id, ...fields? }. Doctor saves the last edits and locks the summary; queues the follow-up reminder (day before, 09:00 PKT) for the patient and the admitting doctor.

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
// deno-lint-ignore no-explicit-any
const CLIN = ["super_admin", "admin", "dept_head", "doctor"];
const READ = [...CLIN, "nurse"];
const s = (v: unknown, max = 4000) => { const t = String(v ?? "").trim().slice(0, max); return t || null; };
const FIELDS = ["diagnosis", "procedures", "course", "condition_at_discharge", "advice_en", "advice_ur"] as const;
/** Cleans editable fields from the request body (only keys that are present). */
// deno-lint-ignore no-explicit-any
function editable(b: any): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) if (f in b) out[f] = s(b[f]);
  if ("follow_up_date" in b) {
    const d = s(b.follow_up_date, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return "Follow-up date is not valid.";
    out.follow_up_date = d;
  }
  if ("medicines" in b) {
    if (!Array.isArray(b.medicines)) return "Medicines list is not valid.";
    out.medicines = b.medicines.slice(0, 50).map((m: Record<string, unknown>) => ({
      name: s(m?.name, 200) ?? "", dose: s(m?.dose, 100), frequency: s(m?.frequency, 50), duration_days: Number(m?.duration_days) > 0 ? Math.min(365, Math.round(Number(m.duration_days))) : null,
      instructions_en: s(m?.instructions_en, 500), instructions_ur: s(m?.instructions_ur, 500),
    })).filter((m: { name: string }) => m.name);
  }
  return out;
}
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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, CLIN)) return fail("forbidden", "Only doctors can finalize the discharge summary.", 403);
  const { data: sum } = await db.from("discharge_summaries").select("*").eq("admission_id", String(b.admission_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!sum) return fail("not_found", "Open the summary draft first.", 404);
  if (sum.finalized_at) return fail("locked", "This summary is already finalized.", 409);
  const fields = editable(b);
  if (typeof fields === "string") return fail("invalid", fields);
  const next = { ...sum, ...fields };
  if (!next.diagnosis || !next.condition_at_discharge) return fail("invalid", "Diagnosis and condition at discharge are required.");
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  if (next.follow_up_date && next.follow_up_date <= today) return fail("invalid", "Follow-up date must be after today.");
  const now = new Date().toISOString();
  const { data: upd, error } = await db.from("discharge_summaries").update({ ...fields, written_by: c.userId, finalized_at: now, finalized_by: c.userId, updated_at: now })
    .eq("id", sum.id).is("finalized_at", null).select().maybeSingle();
  if (error || !upd) return fail("stale", "This summary was just finalized by someone else.", 409);
  let reminders = 0;
  if (upd.follow_up_date) {
    const { data: adm } = await db.from("admissions").select("admitting_doctor_id").eq("id", upd.admission_id).maybeSingle();
    const { data: p } = await db.from("patients").select("user_id, full_name, mrn").eq("id", upd.patient_id).maybeSingle();
    const { data: doc } = adm?.admitting_doctor_id ? await db.from("doctors").select("user_id").eq("id", adm.admitting_doctor_id).maybeSingle() : { data: null };
    const prev = new Date(`${upd.follow_up_date}T09:00:00+05:00`); prev.setUTCDate(prev.getUTCDate() - 1);
    const at = (prev < new Date() ? new Date() : prev).toISOString();
    const rows = [];
    if (p?.user_id) rows.push({ hospital_id: c.hospitalId, user_id: p.user_id, type: "followup_due", scheduled_at: at, dedupe_key: `ds:${upd.id}:p`, vars: { patient: p?.full_name ?? "", date: upd.follow_up_date },
      title: "Follow-up visit tomorrow", body: `Please visit the hospital on ${upd.follow_up_date} for your follow-up after discharge.`, link: "/my-appointments", created_by: c.userId });
    if (doc?.user_id) rows.push({ hospital_id: c.hospitalId, user_id: doc.user_id, type: "followup_due", scheduled_at: at, dedupe_key: `ds:${upd.id}:d`,
      title: "Discharge follow-up due", body: `${p?.full_name ?? "Patient"} (${p?.mrn ?? ""}) follow-up on ${upd.follow_up_date}.`, link: `/patients/${upd.patient_id}`, created_by: c.userId });
    if (rows.length) reminders = (await queueNotes(db, rows)).count;
  }
  await audit(db, req, c, "finalize", "discharge_summary", upd.id, sum, upd);
  return json({ ok: true, data: { ...upd, reminders } });
});
