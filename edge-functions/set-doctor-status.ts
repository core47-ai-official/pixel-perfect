// Paste into Supabase → Edge Functions → new function "set-doctor-status". Turn "Enforce JWT Verification" OFF.
// Input: { doctor_id, status }. Allowed: the doctor themself, receptionist, admin, super_admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
const STATUSES = ["available", "in_opd", "in_surgery", "on_round", "on_leave", "off_duty"];

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
  const hospitalId = prof.hospital_id;
  const { data: myRoles } = await db.from("user_roles").select("role").eq("user_id", userId).eq("hospital_id", hospitalId);

  const body = await req.json().catch(() => ({}));
  const status = String(body.status ?? "");
  if (!STATUSES.includes(status)) return fail("validation", "Unknown status.");
  const { data: doc } = await db.from("doctors").select("*")
    .eq("id", String(body.doctor_id ?? "")).eq("hospital_id", hospitalId).maybeSingle();
  if (!doc) return fail("not_found", "Doctor not found.", 404);

  const allowed = doc.user_id === userId
    || (myRoles ?? []).some((r) => ["super_admin", "admin", "receptionist"].includes(r.role));
  if (!allowed) return fail("forbidden", "You can't change this doctor's status.", 403);
  if (doc.status === status) return json({ ok: true, data: doc });

  const { data: after, error } = await db.from("doctors")
    .update({ status, updated_at: new Date().toISOString() }).eq("id", doc.id).select().single();
  if (error) return fail("db", error.message);

  await db.from("audit_logs").insert({
    hospital_id: hospitalId, user_id: userId, impersonated_by: impersonatedBy,
    action: "set_status", resource: "doctor", resource_id: doc.id,
    before: { status: doc.status }, after: { status }, ip: req.headers.get("x-forwarded-for"),
  });
  return json({ ok: true, data: after });
});
