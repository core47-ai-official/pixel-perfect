// Paste into Supabase → Edge Functions → new function "record-med-administration". Turn "Enforce JWT Verification" OFF.
// Nurse records a scheduled dose. Body: { id, status: given|held|refused|missed, note? } — note (reason) required unless given.
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

const ROLES = ["super_admin", "admin", "nurse"];
const now = () => new Date().toISOString();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ROLES)) return fail("forbidden", "Only a nurse can record medication doses.", 403);
  const status = String(b.status ?? "");
  if (!["given", "held", "refused", "missed"].includes(status)) return fail("invalid", "Choose given, held, refused or missed.");
  const note = String(b.note ?? "").trim().slice(0, 500);
  if (status !== "given" && note.length < 3) return fail("invalid", "Give a reason when a dose is not given.");
  const { data: row } = await db.from("med_administrations").select("*").eq("id", String(b.id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!row) return fail("not_found", "Dose not found.", 404);
  if (row.status !== "scheduled") return fail("locked", "This dose has already been recorded.", 409);
  const { data: adm } = await db.from("admissions").select("status").eq("id", row.admission_id).maybeSingle();
  if (adm?.status !== "admitted") return fail("locked", "The patient is no longer admitted.", 409);
  const { data, error } = await db.from("med_administrations").update({ status, note: note || null, given_at: now(), given_by: c.userId, updated_at: now() })
    .eq("id", row.id).eq("status", "scheduled").select().maybeSingle();
  if (error || !data) return fail("stale", "Someone just recorded this dose. Refresh.", 409);
  await audit(db, req, c, "record", "med_administration", row.id, row, data);
  return json({ ok: true, data });
});
