// Paste into Supabase → Edge Functions → new function "allot-bed". Turn "Enforce JWT Verification" OFF.
// Admin / nurse (in-charge): allot a free bed to a pending bed request (bed becomes reserved), or cancel it. Body: { request_id, bed_id } or { request_id, cancel: true, reason }
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
const genderOk = (wardGender: string, patientGender: string | null) => wardGender === "any" || wardGender === patientGender;
// deno-lint-ignore no-explicit-any
async function bedWithWard(db: DB, hospitalId: string, bedId: string): Promise<any> {
  const { data } = await db.from("beds").select("*, wards!inner(id, name, gender, is_active, hospital_id)").eq("id", bedId).eq("hospital_id", hospitalId).maybeSingle();
  return data;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ["super_admin", "admin", "nurse"])) return fail("forbidden", "Only an admin or nurse in-charge can allot beds.", 403);
  const { data: r } = await db.from("bed_requests").select("*").eq("id", String(b.request_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!r) return fail("not_found", "Bed request not found.", 404);
  if (b.cancel) {
    if (!["pending", "allotted"].includes(r.status)) return fail("invalid", "This request is already closed.");
    if (r.bed_id) await db.from("beds").update({ status: "free", updated_at: new Date().toISOString() }).eq("id", r.bed_id).eq("status", "reserved");
    const { data } = await db.from("bed_requests").update({ status: "cancelled", note: `${r.note}\n[Cancelled] ${String(b.reason ?? "").slice(0, 300)}`.trim(), updated_at: new Date().toISOString() }).eq("id", r.id).select().single();
    await audit(db, req, c, "cancel", "bed_request", r.id, r, data);
    return json({ ok: true, data });
  }
  if (r.status !== "pending") return fail("invalid", "Only pending requests can be allotted.");
  const bed = await bedWithWard(db, c.hospitalId, String(b.bed_id ?? ""));
  if (!bed || !bed.wards.is_active) return fail("not_found", "Bed not found.", 404);
  const { data: p } = await db.from("patients").select("gender").eq("id", r.patient_id).single();
  if (!genderOk(bed.wards.gender, p?.gender ?? null)) return fail("gender", "This ward doesn't match the patient's gender.", 409);
  if (!has(c, ["super_admin", "admin"])) {
    const { data: rr } = await db.from("user_roles").select("ward_ids").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).eq("role", "nurse");
    if (!(rr ?? []).some((x: { ward_ids: string[] }) => (x.ward_ids ?? []).includes(bed.ward_id))) return fail("forbidden", "You're not assigned to this ward.", 403);
  }
  // Reserve only if still free (guards against two people allotting the same bed).
  const { data: reserved } = await db.from("beds").update({ status: "reserved", updated_at: new Date().toISOString() }).eq("id", bed.id).eq("status", "free").select("id").maybeSingle();
  if (!reserved) return fail("bed_taken", "That bed is no longer free.", 409);
  const { data, error } = await db.from("bed_requests").update({ status: "allotted", bed_id: bed.id, allotted_by: c.userId, allotted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", r.id).eq("status", "pending").select().maybeSingle();
  if (error || !data) {
    await db.from("beds").update({ status: "free" }).eq("id", bed.id).eq("status", "reserved");
    return fail("stale", "This request was just changed by someone else.", 409);
  }
  await audit(db, req, c, "allot", "bed_request", r.id, r, data);
  return json({ ok: true, data });
});
