// Paste into Supabase → Edge Functions → new function "set-portal-preferences". Turn "Enforce JWT Verification" OFF.
// Input: { print_language: "en" | "ur" } → updates the signed-in patient's own record (language printed on slips and reports).
// Allowed: patient accounts (own linked record only).
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


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.includes("patient")) return fail("forbidden", "Patient accounts only.", 403);
  const b = await req.json().catch(() => ({}));
  const lang = b.print_language === "ur" ? "ur" : b.print_language === "en" ? "en" : null;
  if (!lang) return fail("validation", "Pick English or Urdu.");
  const { data: before } = await db.from("patients").select("id, print_language").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!before) return fail("not_linked", "Link your hospital record first.", 403);
  const { data: after, error } = await db.from("patients").update({ print_language: lang, updated_at: new Date().toISOString() }).eq("id", before.id).select("id, print_language").single();
  if (error) return fail("db", error.message, 500);
  await db.from("audit_logs").insert({ hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action: "update",
    resource: "patient_print_language", resource_id: before.id, before, after, ip: req.headers.get("x-forwarded-for") });
  return json({ ok: true, data: after });
});
