// Paste into Supabase → Edge Functions → new function "update-bed-status". Turn "Enforce JWT Verification" OFF.
// Nurse / admin / super_admin: change a bed's status from the bed board. Body: { bed_id, status, expected_status? }. Occupied beds change only through discharge or transfer; out-of-service is admin-only.
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
// Must mirror BED_TRANSITIONS in src/lib/beds.ts
const TRANSITIONS: Record<string, string[]> = {
  free: ["reserved", "cleaning", "out_of_service"],
  cleaning: ["free", "out_of_service"],
  reserved: ["free"],
  out_of_service: ["free", "cleaning"],
  occupied: [],
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  const isAdmin = c.roles.some((r) => ["admin", "super_admin"].includes(r));
  if (!isAdmin && !c.roles.includes("nurse")) return fail("forbidden", "Only nurses and admins can change bed status.", 403);
  const b = await req.json().catch(() => ({}));
  const to = String(b.status ?? "");
  const { data: bed } = await db.from("beds").select("*").eq("id", String(b.bed_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!bed) return fail("not_found", "Bed not found.", 404);
  if (b.expected_status && b.expected_status !== bed.status) return fail("stale", "This bed was just changed by someone else. Please check again.", 409);
  if (bed.status === "occupied") return fail("occupied", "An occupied bed can only change through discharge or transfer.", 409);
  if (!(TRANSITIONS[bed.status] ?? []).includes(to)) return fail("invalid", `A ${bed.status} bed can't be changed to ${to}.`);
  if (!isAdmin && (to === "out_of_service" || bed.status === "out_of_service")) return fail("forbidden", "Only an admin can take beds in or out of service.", 403);
  // Only update if status is still what we checked (protects against two people tapping at once).
  const { data, error } = await db.from("beds").update({ status: to, updated_at: new Date().toISOString() })
    .eq("id", bed.id).eq("status", bed.status).select().maybeSingle();
  if (error) return fail("server", "Could not update the bed.", 500);
  if (!data) return fail("stale", "This bed was just changed by someone else. Please check again.", 409);
  await audit(db, req, c, "status_change", "bed", bed.id, { status: bed.status }, { status: to });
  return json({ ok: true, data });
});
