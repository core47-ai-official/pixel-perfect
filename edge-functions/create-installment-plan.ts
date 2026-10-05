// Paste into Supabase → Edge Functions → new function "create-installment-plan". Turn "Enforce JWT Verification" OFF.
// Billing staff. Body: { invoice_id, schedule: [{ due_date: "YYYY-MM-DD", amount }], reason }. Schedule must add up to the balance. Sent to an admin as an installment approval (admins' own plans apply at once); approval creates the plan.
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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, REQUEST_ROLES)) return fail("forbidden", "You can't request billing approvals.", 403);
  b.type = "installment"; b.details = { schedule: b.schedule ?? b.details?.schedule };
  const type = "installment";
  if (!APPROVAL_TYPES.includes(type)) return fail("invalid", "Unknown request type.");
  const reason = String(b.reason ?? "").trim().slice(0, 500);
  if (reason.length < 3) return fail("invalid", "A reason is required.");
  const inv0 = await loadInvoice(db, c.hospitalId, b.invoice_id);
  if (!inv0) return fail("not_found", "Bill not found.", 404);
  const inv = await syncInvoice(db, inv0.id);
  const open = ["open", "partly_paid"].includes(inv.status);
  const gross = r2(Number(inv.total));
  let amount = 0, percent: number | null = null, payment_id: string | null = null;
  if (type === "discount") {
    if (!open) return fail("closed", "This bill is not open.", 409);
    if (b.percent != null && b.percent !== "") {
      percent = r2(Number(b.percent));
      if (!(percent > 0 && percent <= 100)) return fail("invalid", "Percent must be between 0 and 100.");
      amount = r2(gross * percent / 100);
    } else {
      const m = money(b.amount); if (!m) return fail("invalid", "Enter an amount above zero.");
      amount = m; percent = gross > 0 ? r2(amount / gross * 100) : 100;
    }
    if (amount > Number(inv.balance)) return fail("too_much", `The discount is more than the balance (Rs ${inv.balance}).`);
  } else if (type === "waiver") {
    if (!open || Number(inv.balance) <= 0) return fail("closed", "Nothing to waive on this bill.", 409);
    amount = Number(inv.balance); percent = gross > 0 ? r2(amount / gross * 100) : 100;
  } else if (type === "refund") {
    const m = money(b.amount); if (!m) return fail("invalid", "Enter an amount above zero.");
    if (m > Number(inv.paid)) return fail("too_much", `Only Rs ${inv.paid} has been paid on this bill.`);
    amount = m;
  } else if (type === "reversal") {
    const { data: p } = await db.from("payments").select("*").eq("id", String(b.payment_id ?? "")).eq("invoice_id", inv.id).maybeSingle();
    if (!p || !["payment", "deposit_applied"].includes(p.kind)) return fail("invalid", "Choose a payment on this bill.");
    if (p.reversed_by_id) return fail("done", "This payment is already reversed.", 409);
    payment_id = p.id; amount = Number(p.amount);
  } else if (type === "installment") {
    if (!open) return fail("closed", "This bill is not open.", 409);
    amount = Number(inv.balance);
    const sched = cleanSchedule(b.details?.schedule, amount);
    if (typeof sched === "string") return fail("invalid", sched);
    b.details = { schedule: sched };
    const { data: active } = await db.from("installment_plans").select("id").eq("invoice_id", inv.id).eq("status", "active").maybeSingle();
    if (active) return fail("duplicate", "This bill already has an active plan.", 409);
  }
  const { data: prof } = await db.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const maxPct = await roleMaxDiscount(db, c);
  const auto = has(c, ADMIN) || (type === "discount" && (percent ?? 100) <= maxPct);
  const now = new Date().toISOString();
  const { data: a, error } = await db.from("approvals").insert({
    hospital_id: c.hospitalId, type, invoice_id: inv.id, patient_id: inv.patient_id, payment_id, amount, percent, reason,
    details: typeof b.details === "object" && b.details ? b.details : {}, requested_by: c.userId, requested_by_name: prof?.full_name ?? "",
    status: "pending", created_by: c.userId,
  }).select().single();
  if (error) return fail(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? "There's already a request waiting for this bill." : "Could not save the request.", error.code === "23505" ? 409 : 500);
  if (type === "reversal") await db.from("payments").update({ reversal_requested_by: c.userId, reversal_requested_at: now, reversal_reason: reason }).eq("id", payment_id);
  if (auto) {
    try {
      const res = await applyApproval(db, a, c.userId);
      const { data: done } = await db.from("approvals").update({ status: "approved", decided_by: c.userId, decided_at: now,
        decision_note: has(c, ADMIN) ? "Applied by admin" : `Within your limit (${maxPct}%)`, amount: res.applied_amount, updated_at: now }).eq("id", a.id).select().single();
      await audit(db, req, c, `approval.${type}.auto`, "approvals", a.id, null, done);
      return json({ ok: true, data: { approval: done, applied: true, invoice: res.invoice } });
    } catch (e) {
      await db.from("approvals").delete().eq("id", a.id); // nothing was applied
      // deno-lint-ignore no-explicit-any
      return fail((e as any).code ?? "server", (e as Error).message, 409);
    }
  }
  // Tell every admin there's something to decide.
  const { data: admins } = await db.from("user_roles").select("user_id").eq("hospital_id", c.hospitalId).in("role", ADMIN);
  const ids = [...new Set((admins ?? []).map((r: { user_id: string }) => r.user_id))];
  if (ids.length) await db.from("notifications").insert(ids.map((uid) => ({ hospital_id: c.hospitalId, user_id: uid, type: "approval_requested",
    title: `Approval needed: ${type}`, body: `${inv.invoice_no} · Rs ${amount} — ${reason}`.slice(0, 300), link: "/approvals", created_by: c.userId })));
  await audit(db, req, c, `approval.${type}.request`, "approvals", a.id, null, a);
  return json({ ok: true, data: { approval: a, applied: false, max_percent: maxPct } });
});
