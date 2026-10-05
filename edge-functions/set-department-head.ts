// Paste into Supabase → Edge Functions → new function "set-department-head". Turn "Enforce JWT Verification" OFF.
// Input: { department_id, user_id }  (user_id null clears the head). Requires admin or super_admin. Audit-logged.
// The person must be a doctor in that department; they get the dept_head role; the previous head loses it.
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
  const { data: myRoles } = await db.from("user_roles").select("role").eq("user_id", userId).eq("hospital_id", prof.hospital_id);
  if (!(myRoles ?? []).some((r) => r.role === "super_admin" || r.role === "admin"))
    return fail("forbidden", "Only admins can set department heads.", 403);
  const hospitalId = prof.hospital_id;

  const body = await req.json().catch(() => ({}));
  const deptId = String(body.department_id ?? "");
  const headId: string | null = body.user_id ? String(body.user_id) : null;

  const { data: dept } = await db.from("departments").select("*").eq("id", deptId).eq("hospital_id", hospitalId).maybeSingle();
  if (!dept) return fail("not_found", "Department not found.", 404);

  if (headId) {
    const { data: isDoc } = await db.from("user_roles").select("id")
      .eq("user_id", headId).eq("hospital_id", hospitalId).eq("role", "doctor").eq("department_id", deptId).maybeSingle();
    if (!isDoc) return fail("validation", "The department head must be a doctor in this department.");
  }

  const oldHead = dept.head_doctor_id as string | null;
  if (oldHead && oldHead !== headId) {
    await db.from("user_roles").delete()
      .eq("user_id", oldHead).eq("hospital_id", hospitalId).eq("role", "dept_head").eq("department_id", deptId);
  }
  if (headId) {
    const { data: existing } = await db.from("user_roles").select("id")
      .eq("user_id", headId).eq("hospital_id", hospitalId).eq("role", "dept_head").maybeSingle();
    if (existing) {
      await db.from("user_roles").update({ department_id: deptId, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      const { error } = await db.from("user_roles").insert({
        user_id: headId, hospital_id: hospitalId, role: "dept_head", department_id: deptId, created_by: userId,
      });
      if (error) return fail("db", error.message);
    }
    // One person heads one department.
    await db.from("departments").update({ head_doctor_id: null })
      .eq("hospital_id", hospitalId).eq("head_doctor_id", headId).neq("id", deptId);
  }

  const { data: after, error } = await db.from("departments")
    .update({ head_doctor_id: headId, updated_at: new Date().toISOString() }).eq("id", deptId).select().single();
  if (error) return fail("db", error.message);

  await db.from("audit_logs").insert({
    hospital_id: hospitalId, user_id: userId, impersonated_by: impersonatedBy,
    action: "set_head", resource: "department", resource_id: deptId, before: dept, after,
    ip: req.headers.get("x-forwarded-for"),
  });
  return json({ ok: true, data: after });
});
