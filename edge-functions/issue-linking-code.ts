// Paste into Supabase → Edge Functions → new function "issue-linking-code". Turn "Enforce JWT Verification" OFF.
// Body: { patient_id } — receptionist/admin. Returns a fresh 6-digit code valid 7 days; earlier unused codes stop working.
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

// Reception issues codes; doctors and nurses too, so discharge summaries they print carry one.
const STAFF = ["receptionist", "admin", "super_admin", "doctor", "nurse"];
// deno-lint-ignore no-explicit-any
const has = (c: any, r: string[]) => c.roles.some((x: string) => r.includes(x));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, STAFF)) return fail("forbidden", "Only reception can issue linking codes.", 403);
  const { data: p } = await db.from("patients").select("id, mrn, user_id").eq("id", String(b.patient_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!p) return fail("not_found", "Patient not found.", 404);
  if (p.user_id) return json({ ok: true, data: { already_linked: true, mrn: p.mrn } });
  const now = new Date();
  await db.from("patient_link_codes").update({ expires_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("patient_id", p.id).is("used_at", null).gt("expires_at", now.toISOString());
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const expires_at = new Date(now.getTime() + 7 * 86400_000).toISOString();
  const { error } = await db.from("patient_link_codes").insert({ hospital_id: c.hospitalId, patient_id: p.id, code, expires_at, issued_by: c.userId });
  if (error) return fail("failed", "Could not issue a code.", 500);
  await audit(db, req, c, "issue_linking_code", "patients", p.id, null, { expires_at });
  return json({ ok: true, data: { code, expires_at, mrn: p.mrn } });
});
