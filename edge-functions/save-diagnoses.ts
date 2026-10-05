// Paste into Supabase → Edge Functions → new function "save-diagnoses". Turn "Enforce JWT Verification" OFF.
// Visit's doctor: replaces the visit's diagnoses. Exactly one must be primary. Draft visits only.
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

async function audit(db: DB, req: Request, c: any, action: string, resource: string, id: string, before: unknown, after: unknown) {
  await db.from("audit_logs").insert({
    hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action,
    resource, resource_id: id, before, after, ip: req.headers.get("x-forwarded-for"),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  const b = await req.json().catch(() => ({}));
  const { data: doc } = await db.from("doctors").select("id").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).maybeSingle();
  const { data: v } = await db.from("visits").select("id, doctor_id, status").eq("id", String(b.visit_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!v) return fail("not_found", "Visit not found.", 404);
  if (!doc || v.doctor_id !== doc.id) return fail("forbidden", "Only the visit's doctor can set diagnoses.", 403);
  if (v.status !== "draft") return fail("locked", "This note is completed.", 409);
  const items = Array.isArray(b.diagnoses) ? b.diagnoses : [];
  if (items.length === 0 || items.length > 20) return fail("invalid", "Add between 1 and 20 diagnoses.");
  const codes = [...new Set(items.map((d: any) => String(d.code ?? "").toUpperCase()))];
  if (codes.length !== items.length) return fail("invalid", "Each code can be added only once.");
  if (items.filter((d: any) => d.is_primary === true).length !== 1) return fail("invalid", "Mark exactly one diagnosis as primary.");
  const { data: known } = await db.from("icd10_codes").select("code, description").in("code", codes);
  const map = new Map((known ?? []).map((k: any) => [k.code, k.description]));
  if (map.size !== codes.length) return fail("invalid", "Unknown ICD-10 code.");
  const { data: before } = await db.from("visit_diagnoses").select("icd10_code, is_primary").eq("visit_id", v.id);
  const rows = items.map((d: any) => {
    const code = String(d.code).toUpperCase();
    return { hospital_id: c.hospitalId, visit_id: v.id, icd10_code: code, description: map.get(code), is_primary: d.is_primary === true, created_by: c.userId };
  });
  await db.from("visit_diagnoses").delete().eq("visit_id", v.id);
  const { data: after, error } = await db.from("visit_diagnoses").insert(rows).select("id, icd10_code, description, is_primary");
  if (error) return fail("server", "Could not save diagnoses.", 500);
  await audit(db, req, c, "save_diagnoses", "visit", v.id, before, after);
  return json({ ok: true, data: after });
});
