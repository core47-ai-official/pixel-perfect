// Paste into Supabase → Edge Functions → new function "upsert-drug-interaction". Turn "Enforce JWT Verification" OFF.
// Admin / pharmacist: add or edit an interaction between two interaction groups. Body: { id?, group_a, group_b, severity, note, delete? }
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

const EDIT_ROLES = ["admin", "pharmacist", "super_admin"];
const SEVERITIES = ["minor", "moderate", "major", "contraindicated"];
// deno-lint-ignore no-explicit-any
async function audit(db: DB, req: Request, c: any, action: string, id: string, before: unknown, after: unknown) {
  await db.from("audit_logs").insert({ hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action,
    resource: "drug_interaction", resource_id: id, before, after, ip: req.headers.get("x-forwarded-for") });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => EDIT_ROLES.includes(r))) return fail("forbidden", "Only admin or pharmacy can edit interactions.", 403);
  const b = await req.json().catch(() => ({}));
  let before = null;
  if (b.id) {
    const { data } = await db.from("drug_interactions").select("*").eq("id", String(b.id)).eq("hospital_id", c.hospitalId).maybeSingle();
    if (!data) return fail("not_found", "Interaction not found.", 404);
    before = data;
    if (b.delete === true) {
      await db.from("drug_interactions").delete().eq("id", data.id);
      await audit(db, req, c, "delete", data.id, data, null);
      return json({ ok: true, data: { deleted: true } });
    }
  }
  const a = String(b.group_a ?? "").trim().toLowerCase().slice(0, 60);
  const g = String(b.group_b ?? "").trim().toLowerCase().slice(0, 60);
  if (!a || !g) return fail("invalid", "Both groups are required.");
  const severity = SEVERITIES.includes(b.severity) ? b.severity : null;
  if (!severity) return fail("invalid", "Unknown severity.");
  const row = { group_a: a, group_b: g, severity, note: String(b.note ?? "").trim().slice(0, 1000), updated_at: new Date().toISOString() };
  const q = before
    ? db.from("drug_interactions").update(row).eq("id", before.id).select().single()
    : db.from("drug_interactions").insert({ ...row, hospital_id: c.hospitalId, created_by: c.userId }).select().single();
  const { data, error } = await q;
  if (error) return fail(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? "This pair already has an interaction." : "Could not save.", error.code === "23505" ? 409 : 500);
  await audit(db, req, c, before ? "update" : "create", data.id, before, data);
  return json({ ok: true, data });
});
