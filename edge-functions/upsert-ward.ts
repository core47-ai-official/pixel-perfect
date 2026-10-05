// Paste into Supabase → Edge Functions → new function "upsert-ward". Turn "Enforce JWT Verification" OFF.
// Admin / super_admin: create or edit a ward. Body: { id?, name, type, gender, floor, is_active }
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
const TYPES = ["general", "semi_private", "private", "hdu", "icu", "nicu", "isolation", "er"];
const GENDERS = ["male", "female", "any"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => ["admin", "super_admin"].includes(r))) return fail("forbidden", "Only an admin can edit wards.", 403);
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim().slice(0, 100);
  if (name.length < 2) return fail("invalid", "Ward name is required.");
  if (!TYPES.includes(b.type)) return fail("invalid", "Unknown ward type.");
  if (!GENDERS.includes(b.gender)) return fail("invalid", "Unknown gender.");
  const row = { name, type: b.type, gender: b.gender, floor: String(b.floor ?? "").trim().slice(0, 30) || null, is_active: b.is_active !== false, updated_at: new Date().toISOString() };
  let before = null;
  if (b.id) {
    const { data } = await db.from("wards").select("*").eq("id", String(b.id)).eq("hospital_id", c.hospitalId).maybeSingle();
    if (!data) return fail("not_found", "Ward not found.", 404);
    before = data;
    if (!row.is_active) {
      const { count } = await db.from("beds").select("id", { count: "exact", head: true }).eq("ward_id", data.id).eq("status", "occupied");
      if (count) return fail("in_use", "This ward has occupied beds; discharge or move patients first.", 409);
    }
  }
  const { data, error } = before
    ? await db.from("wards").update(row).eq("id", before.id).select().single()
    : await db.from("wards").insert({ ...row, hospital_id: c.hospitalId, created_by: c.userId }).select().single();
  if (error) return fail(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? "A ward with that name already exists." : "Could not save.", error.code === "23505" ? 409 : 500);
  await audit(db, req, c, before ? "update" : "create", "ward", data.id, before, data);
  return json({ ok: true, data });
});
