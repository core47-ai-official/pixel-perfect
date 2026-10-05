// Paste into Supabase → Edge Functions → new function "installment-reminders". Turn "Enforce JWT Verification" OFF.
// Scheduled daily at 09:00 Pakistan time (04:00 UTC) by Supabase Cron, header x-cron-key = CRON_SECRET (same secret as post-daily-room-charges).
// Reminds the patient (if they have an app account) and the cashiers 2 days before, on, and after each due date — once per plan per day.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
// Hospital clock: Pakistan Standard Time (UTC+5, no daylight saving).
const r2 = (n: number) => Math.round(n * 100) / 100;

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
const REMIND_DAYS_BEFORE = 2;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-key") !== secret) return fail("forbidden", "Not allowed.", 403);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = todayPk();
  const soon = new Date(Date.parse(today) + REMIND_DAYS_BEFORE * 864e5).toISOString().slice(0, 10);
  const { data: plans } = await db.from("installment_plans").select("*, invoices(id, invoice_no, paid, balance, status), patients(full_name, mrn, user_id)").eq("status", "active").limit(2000);
  const cashiers = new Map<string, string[]>();
  let sent = 0;
  for (const p0 of plans ?? []) {
    const plan = await refreshPlan(db, p0, p0.invoices);
    if (plan.status !== "active" || p0.last_reminded_on === today) continue;
    const next = (plan.schedule as Inst[]).find((s) => s.paid < s.amount);
    if (!next || next.due_date > soon) continue;
    const owed = r2(next.amount - next.paid);
    const overdue = next.due_date < today;
    const when = overdue ? `was due on ${next.due_date}` : next.due_date === today ? "is due today" : `is due on ${next.due_date}`;
    const notes = [];
    if (p0.patients?.user_id) notes.push({ hospital_id: plan.hospital_id, user_id: p0.patients.user_id, type: "installment_due",
      title: overdue ? "Installment overdue" : "Installment reminder", body: `Rs ${owed} on bill ${p0.invoices.invoice_no} ${when}.`, link: "/my-bills" });
    if (!cashiers.has(plan.hospital_id)) {
      const { data: r } = await db.from("user_roles").select("user_id").eq("hospital_id", plan.hospital_id).eq("role", "cashier");
      cashiers.set(plan.hospital_id, [...new Set((r ?? []).map((x: { user_id: string }) => x.user_id))]);
    }
    for (const uid of cashiers.get(plan.hospital_id)!) notes.push({ hospital_id: plan.hospital_id, user_id: uid, type: "installment_due",
      title: overdue ? "Installment overdue" : "Installment due soon", body: `${p0.patients?.full_name ?? ""} (${p0.patients?.mrn ?? ""}): Rs ${owed} on ${p0.invoices.invoice_no} ${when}.`, link: "/billing" });
    if (notes.length) { await db.from("notifications").insert(notes); sent += notes.length; }
    await db.from("installment_plans").update({ last_reminded_on: today }).eq("id", plan.id);
  }
  return json({ ok: true, data: { plans: plans?.length ?? 0, notifications: sent } });
});
