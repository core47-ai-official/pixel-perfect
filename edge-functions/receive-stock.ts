// Paste into Supabase → Edge Functions → new function "receive-stock". Turn "Enforce JWT Verification" OFF.
// Pharmacist / admin: receive a batch of a medicine. Queues an alert straight away if it expires within 90 days. Body: { medicine_id, batch_no, expiry_date (YYYY-MM-DD), qty, cost_price, supplier_id? }
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

const STOCK_ROLES = ["super_admin", "admin", "pharmacist"];
const now = () => new Date().toISOString();
const todayPk = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const daysUntil = (ymd: string) => Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${todayPk()}T00:00:00Z`)) / 86400e3);
const medName = (m: { generic_name: string; brand_name: string | null; strength: string | null }) =>
  [m.brand_name || m.generic_name, m.strength].filter(Boolean).join(" ");
/** Notifies every pharmacist and admin in the hospital. */
async function notifyStock(db: DB, hospitalId: string, type: string, title: string, body: string, by: string | null, vars?: Record<string, unknown>) {
  const { data: staff } = await db.from("user_roles").select("user_id").eq("hospital_id", hospitalId).in("role", ["pharmacist", "admin"]);
  const ids = [...new Set((staff ?? []).map((x: { user_id: string }) => x.user_id))];
  if (ids.length) await queueNotes(db, ids.map((u) => ({ hospital_id: hospitalId, user_id: u, type, title, body: body.slice(0, 1000), link: "/inventory", created_by: by, vars })));
  return ids.length;
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
  if (!has(c, STOCK_ROLES)) return fail("forbidden", "Only a pharmacist or admin can manage stock.", 403);
  const { data: med } = await db.from("medicines").select("id, generic_name, brand_name, strength").eq("id", String(b.medicine_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!med) return fail("not_found", "Medicine not found.", 404);
  const batch = String(b.batch_no ?? "").trim().slice(0, 60);
  const expiry = String(b.expiry_date ?? "");
  const qty = Math.round(Number(b.qty)), cost = Math.round(Number(b.cost_price ?? 0) * 100) / 100;
  if (!batch) return fail("invalid", "Batch number is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || isNaN(Date.parse(expiry))) return fail("invalid", "Enter a valid expiry date.");
  if (daysUntil(expiry) < 0) return fail("expired", "This batch has already expired.");
  if (!(qty > 0 && qty <= 1_000_000)) return fail("invalid", "Quantity must be more than 0.");
  if (!(cost >= 0)) return fail("invalid", "Check the cost price.");
  let supplierId = null;
  if (b.supplier_id) {
    const { data: s } = await db.from("suppliers").select("id").eq("id", String(b.supplier_id)).eq("hospital_id", c.hospitalId).maybeSingle();
    if (!s) return fail("not_found", "Supplier not found.", 404);
    supplierId = s.id;
  }
  const { data, error } = await db.from("stock_batches").insert({
    hospital_id: c.hospitalId, medicine_id: med.id, batch_no: batch, expiry_date: expiry, qty_received: qty, qty_on_hand: qty,
    cost_price: cost, supplier_id: supplierId, received_by: c.userId,
  }).select().single();
  if (error) return fail(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? "This batch number was already received for this medicine. Use Adjust to change its quantity." : "Could not save.", error.code === "23505" ? 409 : 500);
  const days = daysUntil(expiry);
  let alerted = 0;
  if (days <= 90) alerted = await notifyStock(db, c.hospitalId, "stock_expiring", days <= 30 ? "Batch expires within 30 days" : "Batch expires within 90 days",
    `${medName(med)} — batch ${batch}, ${qty} on hand, expires ${expiry} (${days} days).`, c.userId);
  await audit(db, req, c, "receive", "stock_batch", data.id, null, data);
  return json({ ok: true, data: { ...data, days_to_expiry: days, alert_queued: alerted > 0 } });
});
