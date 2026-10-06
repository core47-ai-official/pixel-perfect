// Paste into Supabase → Edge Functions → new function "link-patient-record". Turn "Enforce JWT Verification" OFF.
// Body: { mrn, code } — patient. Links the caller's account to that patient record (sets patients.user_id, which all patient RLS uses).
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

const MAX_TRIES = 5, LOCK_MIN = 15;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!c.roles.includes("patient")) return fail("forbidden", "Only patient accounts can link a record.", 403);
  const { data: acc } = await db.from("patient_accounts").select("*").eq("user_id", c.userId).maybeSingle();
  if (!acc) return fail("no_account", "Patient account not found.", 404);
  if (acc.patient_id) return fail("already_linked", "Your account is already linked to a record.", 409);
  if (acc.locked_until && new Date(acc.locked_until) > new Date()) return fail("locked", "Too many wrong tries. Please wait 15 minutes.", 429);

  const mrn = String(b.mrn ?? "").trim().toUpperCase();
  const code = String(b.code ?? "").replace(/\D/g, "");
  const bad = async () => {
    const n = (acc.failed_attempts ?? 0) + 1;
    await db.from("patient_accounts").update({ failed_attempts: n >= MAX_TRIES ? 0 : n,
      locked_until: n >= MAX_TRIES ? new Date(Date.now() + LOCK_MIN * 60_000).toISOString() : null }).eq("id", acc.id);
    return fail("invalid_code", "The MRN or code is not correct, or the code has expired.");
  };
  if (!mrn || code.length !== 6) return bad();
  const { data: p } = await db.from("patients").select("id, full_name, mrn, user_id").eq("hospital_id", c.hospitalId).eq("mrn", mrn).maybeSingle();
  if (!p) return bad();
  const nowIso = new Date().toISOString();
  const { data: lc } = await db.from("patient_link_codes").select("id").eq("patient_id", p.id).eq("code", code).is("used_at", null).gt("expires_at", nowIso).maybeSingle();
  if (!lc) return bad();
  if (p.user_id && p.user_id !== c.userId) return fail("taken", "This record is already linked to another account. Please contact reception.", 409);

  // Claim the code (compare-and-set) so it works only once.
  const { data: claimed } = await db.from("patient_link_codes").update({ used_at: nowIso, updated_at: nowIso }).eq("id", lc.id).is("used_at", null).select("id");
  if (!claimed?.length) return bad();
  const { data: setP } = await db.from("patients").update({ user_id: c.userId }).eq("id", p.id).is("user_id", null).select("id");
  if (!setP?.length) {
    await db.from("patient_link_codes").update({ used_at: null }).eq("id", lc.id);
    return fail("taken", "This record is already linked to another account. Please contact reception.", 409);
  }
  const { error } = await db.from("patient_accounts").update({ patient_id: p.id, linked_at: nowIso, failed_attempts: 0, locked_until: null, updated_at: nowIso }).eq("id", acc.id);
  if (error) {
    await db.from("patients").update({ user_id: null }).eq("id", p.id);
    await db.from("patient_link_codes").update({ used_at: null }).eq("id", lc.id);
    return fail("failed", "Could not link your record. Please try again.", 500);
  }
  await audit(db, req, c, "link_patient_record", "patients", p.id, null, { user_id: c.userId });
  return json({ ok: true, data: { patient: { id: p.id, full_name: p.full_name, mrn: p.mrn } } });
});
