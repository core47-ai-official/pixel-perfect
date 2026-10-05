// Paste into Supabase → Edge Functions → new function "set-disposition". Turn "Enforce JWT Verification" OFF.
// Doctor / ER officer / admin. Body: { case_id, disposition: admit|discharge|refer|expired|lama, note?, bed_class?, priority? }. "admit" raises a bed request (same rules as request-bed). The ER bay goes to cleaning.
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
  if (!has(c, ["super_admin", "admin", "er_officer", "doctor", "dept_head"])) return fail("forbidden", "You can't close emergency cases.", 403);
  if (!["admit", "discharge", "refer", "expired", "lama"].includes(b.disposition)) return fail("invalid", "Choose an outcome.");
  const ec = await openCase(db, c.hospitalId, b.case_id);
  if (!ec) return fail("not_found", "Emergency case not found.", 404);
  if (ec.disposition) return fail("closed", "This case is already closed.", 409);
  const now = new Date().toISOString();
  let bedRequestId: string | null = null;
  if (b.disposition === "admit") {
    const CLASSES = ["general", "semi_private", "private", "hdu", "icu", "nicu", "isolation"];
    if (!CLASSES.includes(b.bed_class)) return fail("invalid", "Choose a bed class.");
    const { data: active } = await db.from("admissions").select("id").eq("patient_id", ec.patient_id).eq("status", "admitted").maybeSingle();
    if (active) return fail("already_admitted", "This patient is already admitted.", 409);
    const { data: doc } = await db.from("doctors").select("id").eq("user_id", ec.seen_by ?? c.userId).eq("hospital_id", c.hospitalId).maybeSingle();
    const { data: br, error } = await db.from("bed_requests").insert({
      hospital_id: c.hospitalId, patient_id: ec.patient_id, source: "er", bed_class: b.bed_class, priority: b.priority === "routine" ? "routine" : "urgent",
      requested_by: c.userId, doctor_id: doc?.id ?? null, note: String(b.note ?? "").trim().slice(0, 500), created_by: c.userId,
    }).select("id").single();
    if (error) return fail(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? "This patient already has an open bed request." : "Could not request a bed.", error.code === "23505" ? 409 : 500);
    bedRequestId = br.id;
    await audit(db, req, c, "create", "bed_request", br.id, null, { source: "er", case_id: ec.id });
  }
  const { data } = await db.from("emergency_cases").update({ disposition: b.disposition, disposition_at: now, disposition_note: String(b.note ?? "").trim().slice(0, 2000), bed_request_id: bedRequestId, updated_at: now })
    .eq("id", ec.id).is("disposition", null).select().single();
  if (ec.bay_bed_id) await db.from("beds").update({ status: "cleaning", updated_at: now }).eq("id", ec.bay_bed_id).eq("status", "occupied").is("current_admission_id", null);
  await audit(db, req, c, "disposition", "emergency_case", ec.id, null, { disposition: b.disposition });
  return json({ ok: true, data });
});
