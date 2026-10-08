// Supabase → Edge Functions → "reset-user-password". JWT verification OFF. Super admin sets a temporary password; user must change it at next sign-in.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);

// deno-lint-ignore no-explicit-any
async function getCaller(db: any, req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return { error: fail("unauthorized", "Please sign in again.", 401) };
  let userId = u.user.id as string;
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
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId).eq("hospital_id", prof.hospital_id);
  return { userId, impersonatedBy, hospitalId: prof.hospital_id as string, roles: (roles ?? []).map((r: { role: string }) => r.role) };
}


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ["super_admin","admin","dept_head","doctor","nurse","er_officer","ot_coordinator","receptionist","pharmacist","lab_tech","cashier","outside_doctor"];
const validPw = (p: unknown) => typeof p === "string" && p.length >= 8 && /[a-z]/i.test(p) && /\d/.test(p);
// deno-lint-ignore no-explicit-any
async function audit(db: any, c: any, action: string, id: string, before: unknown, after: unknown) {
  await db.from("audit_logs").insert({ hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action, resource: "user", resource_id: id, before, after });
}
// deno-lint-ignore no-explicit-any
function checkRoles(roles: any, isSuper: boolean): string | null {
  if (!Array.isArray(roles) || !roles.length || roles.length > 12) return "Pick at least one role.";
  for (const r of roles) {
    if (!r || !ROLES.includes(r.role)) return "Unknown role.";
    if (r.role === "super_admin" && !isSuper) return "Only a super admin can give the super admin role.";
    if (r.department_id != null && !UUID.test(r.department_id)) return "Invalid department.";
    if (["doctor","dept_head"].includes(r.role) && !r.department_id) return "Doctors and department heads need a department.";
  }
  return null;
}
// deno-lint-ignore no-explicit-any
async function target(db: any, c: any, id: unknown) {
  if (typeof id !== "string" || !UUID.test(id)) return { error: fail("validation", "Invalid user.") };
  const { data: p } = await db.from("profiles").select("*").eq("id", id).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!p) return { error: fail("not_found", "User not found.", 404) };
  const { data: r } = await db.from("user_roles").select("role, department_id").eq("user_id", id).eq("hospital_id", c.hospitalId);
  const roles = r ?? [];
  if (roles.some((x: { role: string }) => x.role === "super_admin") && !c.roles.includes("super_admin"))
    return { error: fail("forbidden", "Only a super admin can change a super admin.", 403) };
  return { p, roles };
}
// deno-lint-ignore no-explicit-any
async function replaceRoles(db: any, c: any, id: string, roles: any[]) {
  const { data: old } = await db.from("user_roles").select("*").eq("user_id", id).eq("hospital_id", c.hospitalId);
  await db.from("user_roles").delete().eq("user_id", id).eq("hospital_id", c.hospitalId);
  const { error } = await db.from("user_roles").insert(roles.map((r) => ({ user_id: id, hospital_id: c.hospitalId, role: r.role, department_id: r.department_id ?? null, created_by: c.userId })));
  if (error) {
    // deno-lint-ignore no-explicit-any
    if (old?.length) await db.from("user_roles").insert(old.map(({ id: _i, ...o }: any) => o));
    return error.message;
  }
  return null;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(db, req);
  if ("error" in c) return c.error;
  if (c.impersonatedBy) return fail("forbidden", "Not allowed while acting as another user.", 403);
  if (!c.roles.includes("super_admin")) return fail("forbidden", "Only a super admin can do this.", 403);
  const isSuper = c.roles.includes("super_admin");
  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}));

  const t = await target(db, c, b.user_id); if ("error" in t) return t.error;
  if (b.user_id === c.userId) return fail("validation", "Use Change password for your own account.");
  if (!validPw(b.temporary_password)) return fail("validation", "Password needs 8+ characters with letters and a number.");
  const { error: ae } = await db.auth.admin.updateUserById(b.user_id, { password: b.temporary_password });
  if (ae) return fail("auth", ae.message);
  await db.from("profiles").update({ must_change_password: true }).eq("id", b.user_id);
  await audit(db, c, "user.reset_password", b.user_id, null, { must_change_password: true });
  return json({ ok: true, data: { id: b.user_id } });
});
