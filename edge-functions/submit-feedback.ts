// Paste into Supabase → Edge Functions → new function "submit-feedback". Turn "Enforce JWT Verification" OFF.
// Patient (portal, own completed visit) or reception kiosk. Body: { visit_id?, mrn?, rating, comment?, category?, is_complaint?, action? "pending" }.
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
const KIOSK_ROLES = ["super_admin", "admin", "receptionist"];
const CATS = ["general", "doctor", "nursing", "cleanliness", "waiting_time", "billing", "pharmacy", "lab", "staff_behaviour", "other"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const isPatient = !has(c, KIOSK_ROLES) && c.roles.includes("patient") && !c.impersonatedBy;
  if (!isPatient && !has(c, KIOSK_ROLES)) return fail("forbidden", "You can't submit feedback here.", 403);
  let patientId: string | null = null;
  if (isPatient) {
    const { data: p } = await db.from("patients").select("id").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).maybeSingle();
    if (!p) return fail("not_linked", "Link your hospital record first.", 400);
    patientId = p.id;
  }
  if (b.action === "pending") {
    if (!patientId) return json({ ok: true, data: null });
    const since = new Date(Date.now() - 30 * 86400e3).toISOString();
    const { data: vs } = await db.from("visits").select("id, completed_at, doctor_id").eq("patient_id", patientId).eq("status", "completed")
      .gte("completed_at", since).order("completed_at", { ascending: false }).limit(5);
    for (const v of vs ?? []) {
      const { data: f } = await db.from("feedback").select("id").eq("visit_id", v.id).maybeSingle();
      if (f) continue;
      const { data: d } = v.doctor_id ? await db.from("doctors").select("full_name, department_id").eq("id", v.doctor_id).maybeSingle() : { data: null };
      return json({ ok: true, data: { visit_id: v.id, completed_at: v.completed_at, doctor_name: d?.full_name ?? null } });
    }
    return json({ ok: true, data: null });
  }
  const rating = Number(b.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail("invalid", "Choose a rating from 1 to 5.");
  const comment = String(b.comment ?? "").trim().slice(0, 2000) || null;
  const category = CATS.includes(String(b.category)) ? String(b.category) : "general";
  const isComplaint = b.is_complaint === true || rating <= 2;
  if (isComplaint && !comment) return fail("invalid", "Please tell us what went wrong.");
  if (!isPatient && b.mrn) {
    const { data: p } = await db.from("patients").select("id").eq("hospital_id", c.hospitalId).eq("mrn", String(b.mrn).trim().toUpperCase()).maybeSingle();
    if (!p) return fail("not_found", "No patient with that MRN.", 404);
    patientId = p.id;
  }
  let visit: { id: string; doctor_id: string | null } | null = null;
  if (b.visit_id) {
    const { data: v } = await db.from("visits").select("id, patient_id, doctor_id, status").eq("hospital_id", c.hospitalId).eq("id", String(b.visit_id)).maybeSingle();
    if (!v || (patientId && v.patient_id !== patientId)) return fail("not_found", "Visit not found.", 404);
    if (v.status !== "completed") return fail("invalid", "You can rate a visit once it is completed.");
    visit = v; patientId = v.patient_id;
  }
  let departmentId: string | null = null;
  if (visit?.doctor_id) {
    const { data: d } = await db.from("doctors").select("department_id").eq("id", visit.doctor_id).maybeSingle();
    departmentId = d?.department_id ?? null;
  }
  const { data: row, error } = await db.from("feedback").insert({ hospital_id: c.hospitalId, patient_id: patientId, visit_id: visit?.id ?? null,
    doctor_id: visit?.doctor_id ?? null, department_id: departmentId, rating, comment, category, is_complaint: isComplaint,
    status: "open", channel: isPatient ? "portal" : "kiosk", created_by: c.userId }).select().single();
  if (error) return error.code === "23505" ? fail("duplicate", "Feedback for this visit was already given.", 409) : fail("server", "Could not save feedback.", 500);
  await audit(db, req, c, "feedback.submit", "feedback", row.id, null, { rating, is_complaint: isComplaint });
  return json({ ok: true, data: { id: row.id } });
});
