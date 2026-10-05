// Paste into Supabase → Edge Functions → new function "get-discharge-clearance". Turn "Enforce JWT Verification" OFF.
// Staff. Body: { admission_id }. Returns { cleared, reason, balance_due, bills[] } — the same check discharge-patient uses.
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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => r !== "patient")) return fail("forbidden", "Staff only.", 403);
  const { data: adm } = await db.from("admissions").select("id").eq("hospital_id", c.hospitalId).eq("id", String(b.admission_id ?? "")).maybeSingle();
  if (!adm) return fail("not_found", "Admission not found.", 404);
  return json({ ok: true, data: await dischargeClearance(db, c.hospitalId, adm.id) });
});
