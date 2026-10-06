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
const STAFF = ["super_admin", "admin", "receptionist", "cashier", "doctor", "nurse", "er_officer", "dept_head", "ot_coordinator"];
const txt = (v: unknown, n: number) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const pkToday = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
// Used = net (total − discount) of every bill linked to the card; remaining = limit − used, never below 0.
async function refreshUsed(db: DB, entId: string) {
  const { data: e } = await db.from("patient_entitlements").select("*, programme:payer_programmes(id, name, type, rules, is_active)").eq("id", entId).single();
  const { data: invs } = await db.from("invoices").select("total, discount, status").eq("entitlement_id", entId).neq("status", "cancelled");
  const used = r2((invs ?? []).reduce((s: number, i: { total: number; discount: number }) => s + Number(i.total) - Number(i.discount), 0));
  if (used !== Number(e.used_amount)) await db.from("patient_entitlements").update({ used_amount: used, updated_at: new Date().toISOString() }).eq("id", entId);
  const valid = e.is_active && e.programme?.is_active && (!e.valid_until || e.valid_until >= pkToday());
  return { ...e, used_amount: used, remaining: r2(Math.max(0, Number(e.limit_amount) - used)), valid };
}
async function patientEntitlements(db: DB, hospitalId: string, patientId: string) {
  const { data } = await db.from("patient_entitlements").select("id").eq("hospital_id", hospitalId).eq("patient_id", patientId).order("created_at", { ascending: false });
  return Promise.all((data ?? []).map((r: { id: string }) => refreshUsed(db, r.id)));
}
// Admin downloads claims (bills billed to a programme) as CSV for a date range (PKT, by bill date).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ["super_admin", "admin"])) return fail("forbidden", "Only an admin can export claims.", 403);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(b.from)) ? String(b.from) : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(b.to)) ? String(b.to) : null;
  if (!from || !to || from > to) return fail("invalid", "Choose a valid date range.");
  const { data: prog } = await db.from("payer_programmes").select("id, name, type").eq("id", String(b.programme_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!prog) return fail("not_found", "Programme not found.", 404);
  const { data: ents } = await db.from("patient_entitlements").select("id, card_no, limit_amount").eq("programme_id", prog.id);
  const em = new Map((ents ?? []).map((e: any) => [e.id, e]));
  if (!em.size) return json({ ok: true, data: { csv: "", rows: 0, total: 0, programme: prog } });
  const { data: invs, error } = await db.from("invoices")
    .select("id, invoice_no, created_at, total, discount, paid, balance, status, entitlement_id, admission_id, patient:patients(full_name, mrn, cnic), admission:admissions(admitted_at, discharged_at)")
    .eq("hospital_id", c.hospitalId).in("entitlement_id", [...em.keys()])
    .gte("created_at", `${from}T00:00:00${TZ}`).lte("created_at", `${to}T23:59:59.999${TZ}`).order("created_at");
  if (error) return fail("server", "Could not load claims.", 500);
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s; };
  const d = (s: string | null | undefined) => (s ? new Date(new Date(s).getTime() + 5 * 3600e3).toISOString().slice(0, 10) : "");
  const head = ["Programme", "Card no", "Patient", "MRN", "CNIC", "Bill no", "Bill date", "Type", "Admitted", "Discharged", "Gross", "Discount", "Claim amount", "Patient paid", "Status"];
  let total = 0;
  const lines = (invs ?? []).map((i: any) => {
    const e: any = em.get(i.entitlement_id); const net = r2(Number(i.total) - Number(i.discount)); total += net;
    return [prog.name, e?.card_no, i.patient?.full_name, i.patient?.mrn, i.patient?.cnic, i.invoice_no, d(i.created_at), i.admission_id ? "IPD" : "OPD",
      d(i.admission?.admitted_at), d(i.admission?.discharged_at), Number(i.total).toFixed(2), Number(i.discount).toFixed(2), net.toFixed(2), Number(i.paid).toFixed(2), i.status].map(esc).join(",");
  });
  const csv = [head.join(","), ...lines].join("\n");
  await audit(db, req, c, "claim.export", "payer_programmes", prog.id, null, { from, to, rows: lines.length });
  return json({ ok: true, data: { csv, rows: lines.length, total: r2(total), programme: prog } });
});
