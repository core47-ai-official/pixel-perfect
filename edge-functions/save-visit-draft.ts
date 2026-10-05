// Paste into Supabase → Edge Functions → new function "save-visit-draft". Turn "Enforce JWT Verification" OFF.
// Visit's doctor: autosaves note fields while the visit is a draft.
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

const CLINICAL = ["doctor", "dept_head", "nurse", "er_officer"];

/** The caller's doctor row (null if the caller isn't a doctor). */
async function myDoctor(db: DB, c: { userId: string; hospitalId: string }) {
  const { data } = await db.from("doctors").select("id, specialty").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).maybeSingle();
  return data as { id: string; specialty: string } | null;
}

// deno-lint-ignore no-explicit-any
async function audit(db: DB, req: Request, c: any, action: string, resource: string, id: string, before: unknown, after: unknown) {
  await db.from("audit_logs").insert({
    hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action,
    resource, resource_id: id, before, after, ip: req.headers.get("x-forwarded-for"),
  });
}
const clip = (v: unknown, n = 20000) => String(v ?? "").slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  const b = await req.json().catch(() => ({}));
  const doc = await myDoctor(db, c);
  const { data: v } = await db.from("visits").select("*").eq("id", String(b.visit_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!v) return fail("not_found", "Visit not found.", 404);
  if (!doc || v.doctor_id !== doc.id) return fail("forbidden", "Only the visit's doctor can edit the note.", 403);
  if (v.status !== "draft") return fail("locked", "This note is completed. Add an addendum instead.", 409);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["chief_complaint", "history", "examination", "plan"]) if (k in b) patch[k] = clip(b[k]);
  if ("template" in b) patch.template = b.template ? clip(b.template, 50) : null;
  // No audit row per autosave (every 10 s); completion is audited with the full note.
  const { data: after, error } = await db.from("visits").update(patch).eq("id", v.id).eq("status", "draft").select("id, updated_at").single();
  if (error || !after) return fail("locked", "This note was completed meanwhile.", 409);
  return json({ ok: true, data: after });
});
