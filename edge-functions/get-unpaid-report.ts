// Paste into Supabase → Edge Functions → new function "get-unpaid-report". Turn "Enforce JWT Verification" OFF.
// Cashier/admin. Body: { department_id?, payer_type? }. Open balances with ageing buckets (days since bill opened, Pakistan time).
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
const REPORT_ROLES = ["super_admin", "admin", "cashier"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, REPORT_ROLES)) return fail("forbidden", "Only cashiers and admins can see this report.", 403);
  let q = db.from("invoices").select("id, invoice_no, patient_id, visit_id, admission_id, payer_type, total, discount, paid, balance, status, created_at, patients(full_name, mrn, phone), admissions(department_id), visits(doctors(department_id))")
    .eq("hospital_id", c.hospitalId).gt("balance", 0).in("status", ["open", "partly_paid"]).order("created_at").limit(2000);
  if (b.payer_type && b.payer_type !== "all") q = q.eq("payer_type", String(b.payer_type));
  const { data: invs, error } = await q;
  if (error) return fail("server", "Could not load unpaid bills.", 500);
  const { data: depts } = await db.from("departments").select("id, name").eq("hospital_id", c.hospitalId);
  const dname = new Map((depts ?? []).map((d: { id: string; name: string }) => [d.id, d.name]));
  const ids = (invs ?? []).map((i: { id: string }) => i.id);
  const last = new Map<string, { note: string; by_name: string; created_at: string; count: number }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: f } = await db.from("unpaid_followups").select("invoice_id, note, by_name, created_at").in("invoice_id", ids.slice(i, i + 200)).order("created_at", { ascending: false });
    for (const x of f ?? []) { const e = last.get(x.invoice_id); if (e) e.count++; else last.set(x.invoice_id, { note: x.note, by_name: x.by_name, created_at: x.created_at, count: 1 }); }
  }
  const dayPk = (d: Date) => Math.floor((d.getTime() + 5 * 3600e3) / 86400e3);
  const today = dayPk(new Date());
  const totals = { b0_30: 0, b31_60: 0, b60: 0, total: 0, count: 0 };
  // deno-lint-ignore no-explicit-any
  const rows = (invs ?? []).map((i: any) => {
    const department_id = i.admissions?.department_id ?? i.visits?.doctors?.department_id ?? null;
    const age = Math.max(0, today - dayPk(new Date(i.created_at)));
    const bucket = age <= 30 ? "b0_30" : age <= 60 ? "b31_60" : "b60";
    return { id: i.id, invoice_no: i.invoice_no, patient_id: i.patient_id, patient: i.patients?.full_name ?? "", mrn: i.patients?.mrn ?? "", phone: i.patients?.phone ?? "",
      department_id, department: department_id ? dname.get(department_id) ?? "" : "", payer_type: i.payer_type, kind: i.admission_id ? "ipd" : "opd",
      created_at: i.created_at, age, bucket, total: Number(i.total), discount: Number(i.discount), paid: Number(i.paid), balance: Number(i.balance),
      last_followup: last.get(i.id) ?? null };
  }).filter((r: { department_id: string | null }) => !b.department_id || b.department_id === "all" || (b.department_id === "none" ? !r.department_id : r.department_id === b.department_id));
  for (const r of rows) { totals[r.bucket as "b0_30"] = r2(totals[r.bucket as "b0_30"] + r.balance); totals.total = r2(totals.total + r.balance); totals.count++; }
  return json({ ok: true, data: { rows, totals, generated_at: new Date().toISOString() } });
});
