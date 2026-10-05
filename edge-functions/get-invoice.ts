// Paste into Supabase → Edge Functions → new function "get-invoice". Turn "Enforce JWT Verification" OFF.
// Admin / cashier / receptionist / ER officer, or the patient themself. Body: { invoice_id } or { patient_id } (returns all bills, newest first, with lines).
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
const STAFF = ["super_admin", "admin", "cashier", "receptionist", "er_officer"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  let q = db.from("invoices").select("*, invoice_lines(id, description, qty, rate, amount, source_type, source_id, tariff_id, created_at)").eq("hospital_id", c.hospitalId);
  if (b.invoice_id) q = q.eq("id", String(b.invoice_id));
  else if (b.patient_id) q = q.eq("patient_id", String(b.patient_id));
  else return fail("invalid", "Choose a bill or patient.");
  const { data, error } = await q.order("created_at", { ascending: false }).limit(50);
  if (error) return fail("server", "Could not load bills.", 500);
  const rows = data ?? [];
  if (!has(c, STAFF)) {
    const { data: me } = await db.from("patients").select("id").eq("user_id", c.userId).eq("hospital_id", c.hospitalId);
    const mine = new Set((me ?? []).map((p: { id: string }) => p.id));
    if (!rows.length || rows.some((r: { patient_id: string }) => !mine.has(r.patient_id))) return fail("forbidden", "You can't view this bill.", 403);
  }
  // deno-lint-ignore no-explicit-any
  for (const r of rows as any[]) r.invoice_lines.sort((x: any, y: any) => x.created_at.localeCompare(y.created_at));
  if (b.invoice_id && !rows.length) return fail("not_found", "Bill not found.", 404);
  return json({ ok: true, data: b.invoice_id ? rows[0] : rows });
});
