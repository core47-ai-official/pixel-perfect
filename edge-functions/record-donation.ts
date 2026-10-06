// Paste into Supabase → Edge Functions → new function "record-payment". Turn "Enforce JWT Verification" OFF.
// Cashier/admin. Body: { invoice_id, amount, tendered? }. Never accepts more than the balance; returns the payment + updated bill.
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
const ADMIN = ["super_admin", "admin"];
const txt = (v: unknown, n: number) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
async function isSocialWorker(db: DB, c: { userId: string; hospitalId: string }) {
  const { data } = await db.from("user_roles").select("id").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).eq("is_social_worker", true).limit(1);
  return (data ?? []).length > 0;
}
// Fund balance changes only by compare-and-set; retried when someone else moved it first.
async function moveFund(db: DB, fundId: string, delta: number): Promise<{ ok: boolean; before?: number; after?: number; low?: boolean }> {
  for (let i = 0; i < 5; i++) {
    const { data: f } = await db.from("welfare_funds").select("balance").eq("id", fundId).single();
    const before = Number(f.balance), after = r2(before + delta);
    if (after < 0) return { ok: false, low: true, before };
    const { data: u } = await db.from("welfare_funds").update({ balance: after, updated_at: new Date().toISOString() }).eq("id", fundId).eq("balance", f.balance).select("id");
    if ((u ?? []).length) return { ok: true, before, after };
  }
  return { ok: false };
}
// Admin records a donation (or creates a fund on the fly) and gets a numbered donor receipt.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ADMIN)) return fail("forbidden", "Only an admin can record donations or manage funds.", 403);
  if (b.action === "save_fund") {
    const name = txt(b.name, 120); const type = ["zakat", "charity", "other"].includes(b.type) ? b.type : null;
    if (!name || !type) return fail("invalid", "Fund name and type are required.");
    const row = { name, type, is_active: b.is_active !== false, updated_at: new Date().toISOString() };
    const res = b.id
      ? await db.from("welfare_funds").update(row).eq("id", String(b.id)).eq("hospital_id", c.hospitalId).select().single()
      : await db.from("welfare_funds").insert({ ...row, hospital_id: c.hospitalId, created_by: c.userId }).select().single();
    if (res.error) return fail(res.error.code === "23505" ? "duplicate" : "server", res.error.code === "23505" ? "A fund with this name already exists." : "Could not save the fund.", res.error.code === "23505" ? 409 : 500);
    await audit(db, req, c, b.id ? "welfare_fund.update" : "welfare_fund.create", "welfare_funds", res.data.id, null, res.data);
    return json({ ok: true, data: res.data });
  }
  const amount = money(b.amount);
  if (!amount) return fail("invalid", "Enter an amount above zero.");
  const donor = txt(b.donor_name, 120);
  if (!donor) return fail("invalid", "Donor name is required (write Anonymous if needed).");
  const { data: fund } = await db.from("welfare_funds").select("*").eq("id", String(b.fund_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!fund || !fund.is_active) return fail("not_found", "Fund not found or inactive.", 404);
  const receipt_no = await nextReceiptNo(db, c.hospitalId);
  const { data: tx, error } = await db.from("welfare_transactions").insert({ hospital_id: c.hospitalId, fund_id: fund.id, type: "donation", status: "approved",
    amount, donor_name: donor, donor_phone: txt(b.donor_phone, 30), receipt_no, note: txt(b.note, 500), approved_by: c.userId, decided_at: new Date().toISOString(), created_by: c.userId }).select().single();
  if (error) return fail("server", "Could not save the donation.", 500);
  const mv = await moveFund(db, fund.id, amount);
  if (!mv.ok) { await db.from("welfare_transactions").delete().eq("id", tx.id); return fail("busy", "The fund is busy, please try again.", 409); }
  await audit(db, req, c, "welfare.donation", "welfare_transactions", tx.id, { balance: mv.before }, { ...tx, balance: mv.after });
  return json({ ok: true, data: { transaction: tx, fund: { ...fund, balance: mv.after } } });
});
