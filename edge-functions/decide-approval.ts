// Paste into Supabase → Edge Functions → new function "decide-approval". Turn "Enforce JWT Verification" OFF.
// Admin / super_admin. Body: { approval_id, decision: 'approved'|'rejected', note? }. Approving applies it to the bill; the requester is notified either way.
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
// ---- cash helpers (MediCore; identical in every cash function) -------------
const CASH_ROLES = ["super_admin", "admin", "cashier"];
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (v: unknown) => { const n = r2(Number(v)); return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? n : null; };
async function nextReceiptNo(db: DB, hospitalId: string) {
  const year = new Date(Date.now() + 5 * 3600e3).getUTCFullYear();
  for (let i = 0; i < 10; i++) {
    const { data: k } = await db.from("counters").select("id, next_value").eq("hospital_id", hospitalId).eq("key", "receipt").maybeSingle();
    if (!k) { await db.from("counters").insert({ hospital_id: hospitalId, key: "receipt", prefix: "RCP-", next_value: 1, reset_rule: "never" }); continue; }
    const { data: won } = await db.from("counters").update({ next_value: k.next_value + 1, updated_at: new Date().toISOString() })
      .eq("id", k.id).eq("next_value", k.next_value).select("id");
    if (won?.length) return `RCP-${year}-${String(k.next_value).padStart(6, "0")}`;
  }
  throw new Error("Couldn't assign a receipt number.");
}
/** Paid = sum of all payment rows (refunds/reversals are negative); then totals, balance and status are recomputed. */
async function syncInvoice(db: DB, invoiceId: string) {
  const { data: pays } = await db.from("payments").select("amount").eq("invoice_id", invoiceId);
  const paid = r2((pays ?? []).reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0));
  const { data: inv } = await db.from("invoices").select("id, discount, status").eq("id", invoiceId).single();
  const { data: lines } = await db.from("invoice_lines").select("amount").eq("invoice_id", invoiceId);
  const total = r2((lines ?? []).reduce((s: number, l: { amount: number }) => s + Number(l.amount), 0));
  const balance = r2(Math.max(0, total - Number(inv.discount) - paid));
  let status = inv.status;
  if (["open", "partly_paid", "paid"].includes(status)) status = balance <= 0 && total > 0 ? "paid" : paid > 0 ? "partly_paid" : "open";
  const { data } = await db.from("invoices").update({ paid, total, balance, status, updated_at: new Date().toISOString() }).eq("id", invoiceId).select().single();
  return data;
}
async function loadInvoice(db: DB, hospitalId: string, id: unknown) {
  const { data } = await db.from("invoices").select("*").eq("hospital_id", hospitalId).eq("id", String(id ?? "")).maybeSingle();
  return data;
}
// ---- end cash helpers -----------------------------------------------------
// ---- installment + clearance helpers (identical wherever they appear) -----
type Inst = { due_date: string; amount: number; paid: number };
const todayPk = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
/** Checks a proposed schedule against the amount to split. Returns an error message or the cleaned schedule. */
function cleanSchedule(raw: unknown, mustTotal: number): Inst[] | string {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 24) return "The plan needs between 2 and 24 installments.";
  const out: Inst[] = []; let prev = "";
  for (const r of raw) {
    const d = String(r?.due_date ?? ""); const a = r2(Number(r?.amount));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d))) return "Every installment needs a due date.";
    if (!(a > 0)) return "Every installment needs an amount above zero.";
    if (prev && d <= prev) return "Due dates must be in order, one per date.";
    prev = d; out.push({ due_date: d, amount: a, paid: 0 });
  }
  if (out[0].due_date < todayPk()) return "The first due date can't be in the past.";
  const sum = r2(out.reduce((s, x) => s + x.amount, 0));
  if (Math.abs(sum - mustTotal) > 0.01) return `Installments add up to Rs ${sum}, but the balance is Rs ${mustTotal}.`;
  return out;
}
/** Spreads cash paid since the plan started across its installments, oldest first; completes the plan when the bill is cleared. */
// deno-lint-ignore no-explicit-any
async function refreshPlan(db: DB, plan: any, inv: any) {
  let left = r2(Number(inv.paid) - Number(plan.paid_at_start));
  const schedule = (plan.schedule as Inst[]).map((s) => { const p = r2(Math.max(0, Math.min(s.amount, left))); left = r2(left - p); return { ...s, paid: p }; });
  const status = Number(inv.balance) <= 0 || inv.status === "waived" ? "completed" : plan.status;
  if (JSON.stringify(schedule) !== JSON.stringify(plan.schedule) || status !== plan.status) {
    const { data } = await db.from("installment_plans").update({ schedule, status, updated_at: new Date().toISOString() }).eq("id", plan.id).select().single();
    return data ?? { ...plan, schedule, status };
  }
  return plan;
}
/** Discharge is allowed only when every bill of the admission is paid, waived, or covered by an approved installment plan. */
async function dischargeClearance(db: DB, hospitalId: string, admissionId: string) {
  const { data: invs } = await db.from("invoices").select("id, invoice_no, balance, paid, status").eq("hospital_id", hospitalId).eq("admission_id", admissionId);
  const bills: { invoice_id: string; invoice_no: string; balance: number; covered_by: string | null }[] = [];
  for (const inv of invs ?? []) {
    const bal = Number(inv.balance);
    let covered: string | null = bal <= 0 ? (inv.status === "waived" ? "waiver" : "paid") : null;
    if (!covered) {
      const { data: w } = await db.from("approvals").select("id").eq("invoice_id", inv.id).eq("type", "waiver").eq("status", "approved").limit(1);
      if (w?.length && inv.status === "waived") covered = "waiver";
    }
    if (!covered) {
      const { data: plan } = await db.from("installment_plans").select("*").eq("invoice_id", inv.id).eq("status", "active").maybeSingle();
      if (plan) { await refreshPlan(db, plan, inv); covered = "installment"; }
    }
    bills.push({ invoice_id: inv.id, invoice_no: inv.invoice_no, balance: bal, covered_by: covered });
  }
  const open = bills.filter((b) => !b.covered_by);
  const due = r2(open.reduce((s, b) => s + b.balance, 0));
  return {
    cleared: open.length === 0, bills, balance_due: due,
    reason: open.length === 0 ? (bills.some((b) => b.covered_by === "installment") ? "Cleared: remaining balance is on an approved installment plan." : "Cleared: all bills are settled.")
      : `Rs ${due} is still due on ${open.map((b) => b.invoice_no).join(", ")}. Take payment, or get a waiver or installment plan approved.`,
  };
}
// ---- end installment + clearance helpers ---------------------------------
// ---- approval helpers (identical in request-approval and decide-approval) ---
const APPROVAL_TYPES = ["discount", "waiver", "installment", "refund", "reversal"];
const REQUEST_ROLES = ["super_admin", "admin", "cashier", "receptionist", "er_officer"];
const ADMIN = ["super_admin", "admin"];
/** Largest discount % the caller may give without an admin (highest of their roles). */
async function roleMaxDiscount(db: DB, c: { hospitalId: string; roles: string[] }) {
  if (has(c, ADMIN)) return 100;
  const { data: s } = await db.from("company_settings").select("billing").eq("hospital_id", c.hospitalId).maybeSingle();
  const b = s?.billing ?? {};
  const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : d; };
  const per: Record<string, number> = {
    cashier: num(b.max_discount_cashier ?? b.max_discount_percent, 10),
    receptionist: num(b.max_discount_receptionist, 0),
    er_officer: num(b.max_discount_er_officer, 0),
  };
  return Math.max(0, ...c.roles.map((r) => per[r] ?? 0));
}
/** Applies an approved request to the bill. Throws { code, message } if it can no longer be applied. */
// deno-lint-ignore no-explicit-any
async function applyApproval(db: DB, a: any, actorId: string) {
  const now = new Date().toISOString();
  const inv = await syncInvoice(db, a.invoice_id);
  const err = (code: string, message: string) => Object.assign(new Error(message), { code });
  if (a.type === "discount" || a.type === "waiver") {
    if (!["open", "partly_paid"].includes(inv.status)) throw err("closed", "This bill is no longer open.");
    const bal = Number(inv.balance);
    const amount = a.type === "waiver" ? bal : r2(Math.min(Number(a.amount), bal));
    if (amount <= 0) throw err("nothing", "Nothing left to discount on this bill.");
    // Compare-and-set on discount so two approvals can't both land on the same old value.
    const { data: won } = await db.from("invoices").update({ discount: r2(Number(inv.discount) + amount), updated_at: now })
      .eq("id", inv.id).eq("discount", inv.discount).select("id");
    if (!won?.length) throw err("conflict", "The bill just changed. Please try again.");
    let after = await syncInvoice(db, inv.id);
    if (a.type === "waiver" && Number(after.balance) <= 0) {
      const { data } = await db.from("invoices").update({ status: "waived", updated_at: now }).eq("id", inv.id).select().single();
      after = data;
    }
    return { applied_amount: amount, invoice: after };
  }
  if (a.type === "refund") {
    const amount = r2(Number(a.amount));
    if (amount > Number(inv.paid)) throw err("too_much", `Only Rs ${inv.paid} has been paid on this bill.`);
    const receipt_no = await nextReceiptNo(db, a.hospital_id);
    const { data: pay, error } = await db.from("payments").insert({ hospital_id: a.hospital_id, invoice_id: inv.id, patient_id: inv.patient_id,
      receipt_no, kind: "refund", amount: -amount, reason: a.reason, received_by: actorId, created_by: actorId }).select().single();
    if (error) throw err("server", "Could not save the refund.");
    return { applied_amount: amount, payment: pay, invoice: await syncInvoice(db, inv.id) };
  }
  if (a.type === "reversal") {
    const { data: p } = await db.from("payments").select("*").eq("id", a.payment_id).single();
    if (p.reversed_by_id) throw err("done", "This payment is already reversed.");
    const receipt_no = await nextReceiptNo(db, a.hospital_id);
    const { data: rev, error } = await db.from("payments").insert({ hospital_id: a.hospital_id, invoice_id: p.invoice_id, patient_id: p.patient_id,
      receipt_no, kind: "reversal", amount: -Number(p.amount), reason: a.reason, reverses_id: p.id, deposit_id: p.deposit_id,
      received_by: actorId, created_by: actorId }).select().single();
    if (error) throw err(error.code === "23505" ? "done" : "server", error.code === "23505" ? "Already reversed." : "Could not reverse.");
    await db.from("payments").update({ reversed_by_id: rev.id, updated_at: now }).eq("id", p.id);
    if (p.kind === "deposit_applied" && p.deposit_id) {
      const { data: d } = await db.from("deposits").select("applied_amount").eq("id", p.deposit_id).single();
      await db.from("deposits").update({ applied_amount: r2(Math.max(0, Number(d.applied_amount) - Number(p.amount))), updated_at: now }).eq("id", p.deposit_id);
    }
    return { applied_amount: Number(p.amount), payment: rev, invoice: await syncInvoice(db, p.invoice_id) };
  }
  if (a.type === "installment") {
    if (!["open", "partly_paid"].includes(inv.status)) throw err("closed", "This bill is no longer open.");
    const sched = cleanSchedule(a.details?.schedule, Number(inv.balance));
    if (typeof sched === "string") throw err("invalid", sched);
    const { data: plan, error } = await db.from("installment_plans").insert({ hospital_id: a.hospital_id, invoice_id: inv.id, patient_id: inv.patient_id,
      approval_id: a.id, total: Number(inv.balance), paid_at_start: Number(inv.paid), schedule: sched, status: "active",
      approved_by: actorId, approved_at: now, created_by: a.requested_by }).select().single();
    if (error) throw err(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? "This bill already has an active plan." : "Could not create the plan.");
    return { applied_amount: Number(inv.balance), plan, invoice: inv };
  }
  return { applied_amount: 0, invoice: inv };
}
// ---- end approval helpers --------------------------------------------------
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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ADMIN)) return fail("forbidden", "Only an admin can decide approvals.", 403);
  const decision = String(b.decision ?? "");
  if (!["approved", "rejected"].includes(decision)) return fail("invalid", "Approve or reject.");
  const note = String(b.note ?? "").trim().slice(0, 500);
  if (decision === "rejected" && note.length < 3) return fail("invalid", "Please give a reason for rejecting.");
  const { data: a } = await db.from("approvals").select("*").eq("hospital_id", c.hospitalId).eq("id", String(b.approval_id ?? "")).maybeSingle();
  if (!a) return fail("not_found", "Request not found.", 404);
  const now = new Date().toISOString();
  // Claim it first so two admins can't both decide.
  const { data: claimed } = await db.from("approvals").update({ status: "deciding", updated_at: now }).eq("id", a.id).eq("status", "pending").select("id");
  if (!claimed?.length) return fail("done", "This request was already decided.", 409);
  let res: { applied_amount: number; invoice?: unknown } | null = null;
  if (decision === "approved") {
    try { res = await applyApproval(db, a, c.userId); }
    catch (e) {
      await db.from("approvals").update({ status: "pending", updated_at: now }).eq("id", a.id);
      // deno-lint-ignore no-explicit-any
      return fail((e as any).code ?? "server", (e as Error).message, 409);
    }
  } else if (a.type === "reversal" && a.payment_id) {
    await db.from("payments").update({ reversal_requested_by: null, reversal_requested_at: null, reversal_reason: null }).eq("id", a.payment_id);
  }
  const { data: done } = await db.from("approvals").update({ status: decision, decided_by: c.userId, decided_at: now, decision_note: note || null,
    ...(res ? { amount: res.applied_amount } : {}), updated_at: now }).eq("id", a.id).select().single();
  const { data: inv } = await db.from("invoices").select("invoice_no").eq("id", a.invoice_id).single();
  await queueNotes(db, { hospital_id: c.hospitalId, user_id: a.requested_by, type: "approval_decision",
    title: `Your ${a.type} request was ${decision}`, body: `${inv?.invoice_no ?? ""} · Rs ${done.amount}${note ? ` — ${note}` : ""}`.slice(0, 300),
    vars: { kind: a.type, status: decision, invoice: inv?.invoice_no ?? "", amount: done.amount, note: note ?? "" },
    link: "/approvals", created_by: c.userId });
  await audit(db, req, c, `approval.${a.type}.${decision}`, "approvals", a.id, a, done);
  return json({ ok: true, data: { approval: done, invoice: res?.invoice ?? null } });
});
