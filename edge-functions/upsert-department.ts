// Paste into Supabase → Edge Functions → new function "upsert-department". Turn "Enforce JWT Verification" OFF.
// Input: { id?, name, type }   Requires admin or super_admin. Audit-logged.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return fail("unauthorized", "Please sign in again.", 401);
  let userId = u.user.id;
  let impersonatedBy: string | null = null;
  const impId = req.headers.get("x-impersonation-session");
  if (impId) {
    const { data: s } = await db.from("impersonation_sessions").select("*").eq("id", impId).maybeSingle();
    if (!s || s.super_admin_id !== userId || s.ended_at || new Date(s.expires_at) < new Date())
      return fail("forbidden", "Acting session is not active.", 403);
    impersonatedBy = userId; userId = s.target_user_id;
  }
  const { data: prof } = await db.from("profiles").select("hospital_id, is_active").eq("id", userId).maybeSingle();
  if (!prof?.is_active) return fail("forbidden", "Account is not active.", 403);
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId).eq("hospital_id", prof.hospital_id);
  if (!(roles ?? []).some((r) => r.role === "super_admin" || r.role === "admin"))
    return fail("forbidden", "Only admins can manage departments.", 403);
  const hospitalId = prof.hospital_id;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const type = String(body.type ?? "").trim();
  if (name.length < 2 || name.length > 100) return fail("validation", "Department name must be 2–100 characters.");
  if (!type) return fail("validation", "Pick a department type.");
  const dupMsg = (e: { code?: string; message: string }) =>
    fail(e.code === "23505" ? "duplicate" : "db", e.code === "23505" ? "A department with this name already exists." : e.message);

  let before = null;
  let row;
  if (body.id) {
    const { data: old } = await db.from("departments").select("*").eq("id", body.id).eq("hospital_id", hospitalId).maybeSingle();
    if (!old) return fail("not_found", "Department not found.", 404);
    before = old;
    const { data, error } = await db.from("departments")
      .update({ name, type, updated_at: new Date().toISOString() }).eq("id", body.id).select().single();
    if (error) return dupMsg(error);
    row = data;
  } else {
    const { data, error } = await db.from("departments")
      .insert({ hospital_id: hospitalId, name, type, created_by: userId }).select().single();
    if (error) return dupMsg(error);
    row = data;
  }

  await db.from("audit_logs").insert({
    hospital_id: hospitalId, user_id: userId, impersonated_by: impersonatedBy,
    action: body.id ? "update" : "create", resource: "department", resource_id: row.id, before, after: row,
    ip: req.headers.get("x-forwarded-for"),
  });
  return json({ ok: true, data: row });
});
