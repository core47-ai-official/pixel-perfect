// Paste into Supabase → Edge Functions → new function "open-shift". Turn "Enforce JWT Verification" OFF.
// Cashier/admin. Body: { opening_cash }. One open shift per cashier.
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
async function requireOpenShift(db: DB, c: { hospitalId: string; userId: string }) {
  const { data } = await db.from("cashier_shifts").select("id").eq("hospital_id", c.hospitalId).eq("cashier_id", c.userId).eq("status", "open").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
// ---- end cash helpers -----------------------------------------------------
const SHIFT_ROLES = CASH_ROLES;
// deno-lint-ignore no-explicit-any
async function shiftTotals(db: DB, shift: any) {
  const { data: pays } = await db.from("payments").select("kind, amount").eq("shift_id", shift.id);
  const { data: deps } = await db.from("deposits").select("amount").eq("shift_id", shift.id);
  const t = { payments: 0, payment_count: 0, refunds: 0, refund_count: 0, reversals: 0, reversal_count: 0, deposits: 0, deposit_count: 0 };
  for (const p of pays ?? []) {
    const a = Number(p.amount);
    if (p.kind === "payment") { t.payments += a; t.payment_count++; }
    else if (p.kind === "refund") { t.refunds += -a; t.refund_count++; }
    else if (p.kind === "reversal") { t.reversals += -a; t.reversal_count++; }
  }
  for (const d of deps ?? []) { t.deposits += Number(d.amount); t.deposit_count++; }
  for (const k of ["payments", "refunds", "reversals", "deposits"] as const) t[k] = r2(t[k]);
  const expected_cash = r2(Number(shift.opening_cash) + t.payments + t.deposits - t.refunds - t.reversals);
  return { ...t, expected_cash };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, SHIFT_ROLES)) return fail("forbidden", "Only cashiers can open a shift.", 403);
  const opening = b.opening_cash === 0 || b.opening_cash === "0" ? 0 : money(b.opening_cash);
  if (opening === null) return fail("invalid", "Enter the opening cash (0 or more).");
  if (await requireOpenShift(db, c)) return fail("already_open", "You already have an open shift.", 409);
  const { data: prof } = await db.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const { data: shift, error } = await db.from("cashier_shifts").insert({ hospital_id: c.hospitalId, cashier_id: c.userId,
    cashier_name: prof?.full_name ?? "", opening_cash: opening, created_by: c.userId }).select().single();
  if (error) return error.code === "23505" ? fail("already_open", "You already have an open shift.", 409) : fail("server", "Could not open the shift.", 500);
  await audit(db, req, c, "shift.open", "cashier_shifts", shift.id, null, shift);
  return json({ ok: true, data: shift });
});
