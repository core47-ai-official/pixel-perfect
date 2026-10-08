// Supabase → Edge Functions → "list-users". JWT verification OFF.
// Lists staff of the caller's hospital with roles and last sign-in. admin/super_admin/dept_head.
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


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(db, req);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => ["admin", "super_admin", "dept_head"].includes(r)))
    return fail("forbidden", "You don't have access to the users list.", 403);
  const { data: profs, error } = await db.from("profiles")
    .select("id, full_name, email, phone, photo_url, is_active").eq("hospital_id", c.hospitalId).order("full_name").limit(1000);
  if (error) return fail("db", error.message);
  const { data: roles } = await db.from("user_roles").select("user_id, role, department_id").eq("hospital_id", c.hospitalId).limit(5000);
  const byUser = new Map<string, { role: string; department_id: string | null }[]>();
  for (const r of roles ?? []) { const l = byUser.get(r.user_id) ?? []; l.push({ role: r.role, department_id: r.department_id }); byUser.set(r.user_id, l); }
  // last sign-in from auth (paged)
  const last = new Map<string, string | null>();
  for (let page = 1; page <= 20; page++) {
    const { data: au } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    for (const u of au?.users ?? []) last.set(u.id, u.last_sign_in_at ?? null);
    if (!au || au.users.length < 1000) break;
  }
  const rows = (profs ?? [])
    .map((p: { id: string }) => ({ ...p, roles: byUser.get(p.id) ?? [], last_sign_in_at: last.get(p.id) ?? null }))
    .filter((p: { roles: { role: string }[] }) => p.roles.length && !p.roles.every((r) => r.role === "patient"));
  return json({ ok: true, data: rows });
});
