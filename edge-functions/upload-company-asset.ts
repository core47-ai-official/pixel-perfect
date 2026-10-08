// Supabase → Edge Functions → "upload-company-asset". JWT verification OFF.
// Input: { kind, filename, content_type, data_base64 }. Admin / super_admin. Stores in private "branding" bucket.
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

const RULES: Record<string, { max: number; types: string[] }> = {
  logo: { max: 1048576, types: ["image/png","image/svg+xml","image/jpeg","image/webp"] },
  mono_logo: { max: 1048576, types: ["image/png","image/svg+xml"] },
  favicon: { max: 262144, types: ["image/png","image/x-icon","image/vnd.microsoft.icon","image/svg+xml"] },
  signature: { max: 524288, types: ["image/png"] },
  stamp: { max: 524288, types: ["image/png"] },
};
const EXT: Record<string, string> = { "image/png": "png", "image/svg+xml": "svg", "image/jpeg": "jpg", "image/webp": "webp", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(db, req);
  if ("error" in c) return c.error;
  if (!c.roles.includes("super_admin") && !c.roles.includes("admin")) return fail("forbidden", "Only admins can upload branding.", 403);
  const body = await req.json().catch(() => ({}));
  const rule = RULES[String(body.kind)];
  const type = String(body.content_type ?? "");
  if (!rule || !rule.types.includes(type)) return fail("validation", "This file type is not allowed.");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(String(body.data_base64 ?? "").replace(/^data:[^,]*,/, "")), (ch) => ch.charCodeAt(0)); }
  catch { return fail("validation", "File could not be read."); }
  if (!bytes.length || bytes.length > rule.max) return fail("validation", "File is too large.");
  const path = c.hospitalId + "/" + body.kind + "-" + Date.now() + "." + EXT[type];
  const { error } = await db.storage.from("branding").upload(path, bytes, { contentType: type, upsert: true });
  if (error) return fail("storage", error.message);
  const { data: s } = await db.storage.from("branding").createSignedUrl(path, 3600);
  await db.from("audit_logs").insert({ hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action: "upload", resource: "company_asset", after: { kind: body.kind, path } });
  return json({ ok: true, data: { path, url: s?.signedUrl ?? "" } });
});
