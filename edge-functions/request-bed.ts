// Paste into Supabase → Edge Functions → new function "request-bed". Turn "Enforce JWT Verification" OFF.
// Doctor / ER officer / dept head / receptionist / nurse / admin: ask for a bed for a patient. Body: { patient_id, source: er|opd, bed_class, priority: routine|urgent, doctor_id?, note? }
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
const CLASSES = ["general", "semi_private", "private", "hdu", "icu", "nicu", "isolation", "er"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ["super_admin", "admin", "dept_head", "doctor", "er_officer", "receptionist", "nurse"])) return fail("forbidden", "You can't request beds.", 403);
  const { data: p } = await db.from("patients").select("id").eq("id", String(b.patient_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!p) return fail("not_found", "Patient not found.", 404);
  if (!CLASSES.includes(b.bed_class)) return fail("invalid", "Choose a bed class.");
  const { data: active } = await db.from("admissions").select("id").eq("patient_id", p.id).eq("status", "admitted").maybeSingle();
  if (active) return fail("already_admitted", "This patient is already admitted.", 409);
  let doctorId: string | null = null;
  if (b.doctor_id) {
    const { data: d } = await db.from("doctors").select("id").eq("id", String(b.doctor_id)).eq("hospital_id", c.hospitalId).maybeSingle();
    doctorId = d?.id ?? null;
  }
  const { data, error } = await db.from("bed_requests").insert({
    hospital_id: c.hospitalId, patient_id: p.id, source: b.source === "er" ? "er" : "opd", bed_class: b.bed_class,
    priority: b.priority === "urgent" ? "urgent" : "routine", requested_by: c.userId, doctor_id: doctorId,
    note: String(b.note ?? "").trim().slice(0, 500), created_by: c.userId,
  }).select().single();
  if (error) return fail(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? "This patient already has an open bed request." : "Could not save.", error.code === "23505" ? 409 : 500);
  await audit(db, req, c, "create", "bed_request", data.id, null, data);
  return json({ ok: true, data });
});
