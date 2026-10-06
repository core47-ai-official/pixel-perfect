// Paste into Supabase → Edge Functions → new function "upload-symptom-attachment". Turn "Enforce JWT Verification" OFF.
// Patient only. Body: { content_base64, content_type }. Saves to private bucket "tracker" at <patient_account_id>/<uuid>.<ext>; max 5MB; JPEG/PNG/WebP/PDF only (checked by file signature).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
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
const BOOT = async (req: Request) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  const b = await req.json().catch(() => ({}));
  return { db, c, b };
};
const has = (c: { roles: string[] }, list: string[]) => c.roles.some((r) => list.includes(r));
async function myAccount(db: DB, c: { userId: string; roles: string[]; impersonatedBy: string | null }) {
  if (!c.roles.includes("patient") || c.impersonatedBy) return null;
  const { data } = await db.from("patient_accounts").select("id, patient_id").eq("user_id", c.userId).maybeSingle();
  return data as { id: string; patient_id: string | null } | null;
}
const TYPES: Record<string, { ext: string; magic: (u: Uint8Array) => boolean }> = {
  "image/jpeg": { ext: "jpg", magic: (u) => u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff },
  "image/png": { ext: "png", magic: (u) => u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47 },
  "image/webp": { ext: "webp", magic: (u) => String.fromCharCode(...u.slice(0, 4)) === "RIFF" && String.fromCharCode(...u.slice(8, 12)) === "WEBP" },
  "application/pdf": { ext: "pdf", magic: (u) => String.fromCharCode(...u.slice(0, 5)) === "%PDF-" },
};
const MAX = 5 * 1024 * 1024;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const acct = await myAccount(db, c);
  if (!acct) return fail("forbidden", "Only patients can upload to their own tracker.", 403);
  const type = TYPES[String(b.content_type ?? "")];
  if (!type) return fail("invalid", "Only photos (JPG, PNG, WebP) or PDF files can be added.");
  const b64 = String(b.content_base64 ?? "").replace(/^data:[^,]*,/, "");
  if (b64.length > Math.ceil(MAX / 3) * 4 + 8) return fail("too_large", "The file is larger than 5 MB.");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)); } catch { return fail("invalid", "The file couldn't be read."); }
  if (!bytes.length) return fail("invalid", "The file is empty.");
  if (bytes.length > MAX) return fail("too_large", "The file is larger than 5 MB.");
  if (!type.magic(bytes)) return fail("invalid", "The file doesn't look like a real photo or PDF.");
  const path = `${acct.id}/${crypto.randomUUID()}.${type.ext}`;
  const { error } = await db.storage.from("tracker").upload(path, bytes, { contentType: String(b.content_type), upsert: false });
  if (error) return fail("server", "Couldn't upload the file.", 500);
  return json({ ok: true, data: { path } });
});
