// Paste into Supabase → Edge Functions → new function "request-leave". Turn "Enforce JWT Verification" OFF.
// Input: { from_date "YYYY-MM-DD", to_date, type, reason }. Caller must have a doctor profile (requests for self).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ["casual", "sick", "annual", "conference", "emergency", "other"];

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
  const { data: prof } = await db.from("profiles").select("hospital_id, is_active, full_name").eq("id", userId).maybeSingle();
  if (!prof?.is_active) return fail("forbidden", "Account is not active.", 403);
  const hospitalId = prof.hospital_id;

  const { data: doc } = await db.from("doctors").select("id, department_id").eq("hospital_id", hospitalId).eq("user_id", userId).maybeSingle();
  if (!doc) return fail("forbidden", "Only doctors can request leave.", 403);

  const b = await req.json().catch(() => ({}));
  const from = String(b.from_date ?? ""), to = String(b.to_date ?? "");
  const type = String(b.type ?? "casual");
  const reason = String(b.reason ?? "").trim().slice(0, 500);
  if (!DATE.test(from) || !DATE.test(to) || to < from) return fail("validation", "End date must be on or after start date.");
  const today = new Date().toISOString().slice(0, 10);
  if (to < today) return fail("validation", "Leave can't be entirely in the past.");
  if (!TYPES.includes(type)) return fail("validation", "Unknown leave type.");
  if (reason.length < 3) return fail("validation", "Please give a short reason.");

  // No overlapping pending/approved leave.
  const { data: clash } = await db.from("doctor_leaves").select("id").eq("doctor_id", doc.id)
    .in("status", ["pending", "approved"]).lte("from_date", to).gte("to_date", from).limit(1);
  if (clash?.length) return fail("validation", "You already have leave requested for some of these dates.");

  const { data: row, error } = await db.from("doctor_leaves").insert({
    hospital_id: hospitalId, doctor_id: doc.id, from_date: from, to_date: to, type, reason, created_by: userId,
  }).select().single();
  if (error) return fail("db", error.message);

  // Tell the department head(s) and admins there's a request waiting.
  const { data: approvers } = await db.from("user_roles").select("user_id, role, department_id").eq("hospital_id", hospitalId)
    .or(`role.in.(admin,super_admin),and(role.eq.dept_head,department_id.eq.${doc.department_id})`);
  const ids = [...new Set((approvers ?? []).map((a) => a.user_id).filter((id) => id !== userId))];
  if (ids.length) await db.from("notifications").insert(ids.map((id) => ({
    hospital_id: hospitalId, user_id: id, type: "leave_requested",
    title: `Leave request: ${prof.full_name}`, body: `${from} to ${to}`, link: "/leave-approvals", created_by: userId,
  })));

  await db.from("audit_logs").insert({
    hospital_id: hospitalId, user_id: userId, impersonated_by: impersonatedBy,
    action: "create", resource: "doctor_leave", resource_id: row.id, before: null, after: row,
    ip: req.headers.get("x-forwarded-for"),
  });
  return json({ ok: true, data: row });
});
