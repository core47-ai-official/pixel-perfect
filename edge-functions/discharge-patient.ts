// Paste into Supabase → Edge Functions → new function "discharge-patient". Turn "Enforce JWT Verification" OFF.
// Discharge an admitted patient. Body: { admission_id, discharge_type: regular|lama|referred|death|absconded, note? }. Blocked unless every bill of the admission is paid, waived, or on an approved installment plan. Bed → cleaning.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
const BOOKING_ROLES = ["super_admin", "admin", "receptionist", "dept_head", "doctor", "er_officer"];
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
const genderOk = (wardGender: string, patientGender: string | null) => wardGender === "any" || wardGender === patientGender;
// deno-lint-ignore no-explicit-any
async function bedWithWard(db: DB, hospitalId: string, bedId: string): Promise<any> {
  const { data } = await db.from("beds").select("*, wards!inner(id, name, gender, is_active, hospital_id)").eq("id", bedId).eq("hospital_id", hospitalId).maybeSingle();
  return data;
}
const TYPES = ["regular", "lama", "referred", "death", "absconded"];
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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ["super_admin", "admin", "dept_head", "doctor", "nurse"])) return fail("forbidden", "You can't discharge patients.", 403);
  if (!TYPES.includes(b.discharge_type)) return fail("invalid", "Choose the discharge type.");
  const { data: adm } = await db.from("admissions").select("*").eq("id", String(b.admission_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!adm || adm.status !== "admitted") return fail("not_found", "Active admission not found.", 404);
  const clear = await dischargeClearance(db, c.hospitalId, adm.id);
  if (!clear.cleared) return fail("billing", clear.reason, 409);
  const now = new Date().toISOString();
  const { data: upd, error } = await db.from("admissions").update({ status: "discharged", discharged_at: now, discharge_type: b.discharge_type,
    discharge_note: String(b.note ?? "").trim().slice(0, 2000) || null, updated_at: now }).eq("id", adm.id).eq("status", "admitted").select().maybeSingle();
  if (error || !upd) return fail("stale", "This admission was just changed by someone else.", 409);
  if (adm.bed_id) await db.from("beds").update({ status: "cleaning", current_admission_id: null, updated_at: now }).eq("id", adm.bed_id).eq("current_admission_id", adm.id);
  await audit(db, req, c, "discharge", "admission", adm.id, adm, upd);
  return json({ ok: true, data: upd });
});
