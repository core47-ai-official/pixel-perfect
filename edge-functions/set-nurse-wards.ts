// Paste into Supabase → Edge Functions → new function "set-nurse-wards". Turn "Enforce JWT Verification" OFF.
// Admin / super_admin: assign the nurses for a ward. Body: { ward_id, nurse_ids?: string[] }. Without nurse_ids it just returns who is assigned. Adds the ward to these nurses and removes it from other nurses.
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
  if (!c.roles.some((r) => ["admin", "super_admin"].includes(r))) return fail("forbidden", "Only an admin can assign nurses.", 403);
  const b = await req.json().catch(() => ({}));
  const { data: ward } = await db.from("wards").select("id").eq("id", String(b.ward_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!ward) return fail("not_found", "Ward not found.", 404);
  if (!Array.isArray(b.nurse_ids)) {
    // Read-only: who is assigned now.
    const { data: rows } = await db.from("user_roles").select("user_id, is_in_charge").eq("hospital_id", c.hospitalId).eq("role", "nurse").contains("ward_ids", [ward.id]);
    return json({ ok: true, data: { ward_id: ward.id, nurse_ids: (rows ?? []).map((r: { user_id: string }) => r.user_id),
      in_charge_ids: (rows ?? []).filter((r: { is_in_charge: boolean }) => r.is_in_charge).map((r: { user_id: string }) => r.user_id) } });
  }
  const want = new Set((Array.isArray(b.nurse_ids) ? b.nurse_ids : []).map(String).slice(0, 200));
  const { data: rows } = await db.from("user_roles").select("id, user_id, ward_ids, is_in_charge").eq("hospital_id", c.hospitalId).eq("role", "nurse");
  // Ward in-charge is one flag per nurse (it applies to every ward they are assigned to); it can run the duty roster for those wards.
  const charge = Array.isArray(b.in_charge_ids) ? new Set(b.in_charge_ids.map(String)) : null;
  const before: Record<string, string[]> = {}, after: Record<string, string[]> = {};
  for (const r of rows ?? []) {
    const has = (r.ward_ids ?? []).includes(ward.id);
    const should = want.has(r.user_id);
    if (charge && should) {
      const flag = charge.has(r.user_id);
      if (flag !== !!r.is_in_charge) await db.from("user_roles").update({ is_in_charge: flag, updated_at: new Date().toISOString() }).eq("id", r.id);
    }
    if (has === should) continue;
    const next = should ? [...(r.ward_ids ?? []), ward.id] : (r.ward_ids ?? []).filter((x: string) => x !== ward.id);
    const { error } = await db.from("user_roles").update({ ward_ids: next, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) return fail("server", "Could not save.", 500);
    before[r.user_id] = r.ward_ids ?? []; after[r.user_id] = next;
  }
  await audit(db, req, c, "assign_nurses", "ward", ward.id, before, after);
  const assigned = (rows ?? []).filter((r: { user_id: string }) => want.has(r.user_id)).map((r: { user_id: string }) => r.user_id);
  return json({ ok: true, data: { ward_id: ward.id, nurse_ids: assigned, in_charge_ids: charge ? [...charge].filter((u) => want.has(u as string)) : undefined } });
});
