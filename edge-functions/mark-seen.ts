// Paste into Supabase → Edge Functions → new function "mark-seen". Turn "Enforce JWT Verification" OFF.
// Doctor / ER officer / dept head. Body: { case_id }. Records who saw the patient first.
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
const ER_ROLES = ["super_admin", "admin", "er_officer", "receptionist", "doctor", "nurse", "dept_head"];
const COLORS = ["red", "orange", "yellow", "green"];
// deno-lint-ignore no-explicit-any
async function openCase(db: DB, hospitalId: string, id: unknown): Promise<any> {
  const { data } = await db.from("emergency_cases").select("*").eq("id", String(id ?? "")).eq("hospital_id", hospitalId).maybeSingle();
  return data;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ["super_admin", "admin", "er_officer", "doctor", "dept_head"])) return fail("forbidden", "Only doctors and ER officers can mark a patient seen.", 403);
  const ec = await openCase(db, c.hospitalId, b.case_id);
  if (!ec) return fail("not_found", "Emergency case not found.", 404);
  if (ec.disposition) return fail("closed", "This case is already closed.", 409);
  if (ec.seen_at) return fail("already_seen", "Already marked as seen.", 409);
  const { data: prof } = await db.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const { data } = await db.from("emergency_cases").update({ seen_by: c.userId, seen_by_name: prof?.full_name ?? "", seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", ec.id).is("seen_at", null).select().single();
  await audit(db, req, c, "mark_seen", "emergency_case", ec.id, null, { seen_by: c.userId });
  return json({ ok: true, data });
});
