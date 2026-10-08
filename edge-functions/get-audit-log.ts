// Supabase → Edge Functions → "get-audit-log". JWT verification OFF.
// Input: { user_id?, patient?, resource?, action?, from?, to?, page, page_size }. super_admin only.
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
const DATE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(db, req);
  if ("error" in c) return c.error;
  if (!c.roles.includes("super_admin")) return fail("forbidden", "Only a super admin can view the audit log.", 403);
  const b = await req.json().catch(() => ({}));
  const page = Math.max(1, Number(b.page) || 1);
  const size = Math.min(100, Math.max(1, Number(b.page_size) || 25));

  let q = db.from("audit_logs")
    .select("id, created_at, user_id, impersonated_by, action, resource, resource_id, before, after, ip", { count: "exact" })
    .eq("hospital_id", c.hospitalId);
  if (b.user_id) { if (!UUID.test(b.user_id)) return fail("validation", "Invalid user."); q = q.or("user_id.eq." + b.user_id + ",impersonated_by.eq." + b.user_id); }
  if (b.resource) q = q.ilike("resource", "%" + String(b.resource).replace(/[%_,()]/g, "").slice(0, 50) + "%");
  if (b.action) q = q.ilike("action", "%" + String(b.action).replace(/[%_,()]/g, "").slice(0, 50) + "%");
  if (b.from) { if (!DATE.test(b.from)) return fail("validation", "Invalid From date."); q = q.gte("created_at", b.from + "T00:00:00+05:00"); }
  if (b.to) { if (!DATE.test(b.to)) return fail("validation", "Invalid To date."); q = q.lte("created_at", b.to + "T23:59:59.999+05:00"); }
  if (b.patient) {
    const p = String(b.patient).trim();
    let pid: string | null = UUID.test(p) ? p : null;
    if (!pid) {
      const { data: pt } = await db.from("patients").select("id").eq("hospital_id", c.hospitalId).ilike("mrn", p).maybeSingle();
      pid = pt?.id ?? null;
    }
    if (!pid) return json({ ok: true, data: { rows: [], total: 0 } });
    q = q.eq("resource_id", pid);
  }
  const { data, count, error } = await q.order("created_at", { ascending: false }).range((page - 1) * size, page * size - 1);
  if (error) return fail("db", error.message);
  return json({ ok: true, data: { rows: data ?? [], total: count ?? 0 } });
});
