// Paste into Supabase → Edge Functions → new function "upsert-lab-test". Turn "Enforce JWT Verification" OFF.
// Admin / super_admin: create or edit a lab or radiology test. Body: { id?, code, name, category, sample_type, price, reference_range, turnaround_hours, is_active }
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => ["admin", "super_admin"].includes(r))) return fail("forbidden", "Only an admin can edit lab tests.", 403);
  const b = await req.json().catch(() => ({}));
  const code = String(b.code ?? "").trim().toUpperCase().slice(0, 30);
  const name = String(b.name ?? "").trim().slice(0, 200);
  if (!code || name.length < 2) return fail("invalid", "Code and name are required.");
  const category = b.category === "radiology" ? "radiology" : "lab";
  const price = Number(b.price ?? 0);
  if (!Number.isFinite(price) || price < 0) return fail("invalid", "Price must be 0 or more.");
  const tat = Math.round(Number(b.turnaround_hours ?? 24));
  if (!Number.isFinite(tat) || tat < 0 || tat > 2000) return fail("invalid", "Turnaround hours is out of range.");
  const row = { code, name, category, sample_type: String(b.sample_type ?? "").trim().slice(0, 100) || null,
    price: Math.round(price * 100) / 100, reference_range: String(b.reference_range ?? "").trim().slice(0, 500) || null,
    turnaround_hours: tat, is_active: b.is_active !== false, updated_at: new Date().toISOString() };
  let before = null;
  if (b.id) {
    const { data } = await db.from("lab_tests").select("*").eq("id", String(b.id)).eq("hospital_id", c.hospitalId).maybeSingle();
    if (!data) return fail("not_found", "Test not found.", 404);
    before = data;
  }
  const { data, error } = before
    ? await db.from("lab_tests").update(row).eq("id", before.id).select().single()
    : await db.from("lab_tests").insert({ ...row, hospital_id: c.hospitalId, created_by: c.userId }).select().single();
  if (error) return fail(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? "That code is already used." : "Could not save.", error.code === "23505" ? 409 : 500);
  await audit(db, req, c, before ? "update" : "create", "lab_test", data.id, before, data);
  return json({ ok: true, data });
});
