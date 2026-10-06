// Paste into Supabase → Edge Functions → new function "get-tracker-dashboard". Turn "Enforce JWT Verification" OFF.
// Patient only (read). Today (Pakistan time): readings, symptoms, doses, next appointment, last 5 alerts.
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
// ---- measurement rules (MediCore; identical in log-measurement and update-measurement, mirrored in src/lib/measurements.ts) ----
// deno-lint-ignore no-explicit-any
async function myAccount(db: DB, c: any) {
  // Patients see their own tracker; a super_admin sees it only while acting as that patient.
  const { data } = await db.from("patient_accounts").select("id, patient_id, hospital_id").eq("user_id", c.userId).maybeSingle();
  return data as { id: string; patient_id: string | null; hospital_id: string } | null;
}
const PKMS = 5 * 3600e3;
const dayStartIso = (off = 0) => { const d = new Date(Date.now() + PKMS).toISOString().slice(0, 10); return new Date(Date.parse(`${d}T00:00:00Z`) - PKMS + off * 86400e3).toISOString(); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c } = await BOOT(req);
  if ("error" in c) return c.error;
  const acct = await myAccount(db, c);
  if (!acct) return fail("forbidden", "Only patients have a health tracker.", 403);
  const from = dayStartIso(0), to = dayStartIso(1);
  const [{ data: prof }, { data: readings }, { data: symptoms }, { data: doses }, { data: alerts }] = await Promise.all([
    db.from("profiles").select("full_name").eq("id", c.userId).maybeSingle(),
    db.from("measurements").select("id, type, value_1, value_2, unit, original_value, original_unit, context, measured_at")
      .eq("patient_account_id", acct.id).is("deleted_at", null).gte("measured_at", from).lt("measured_at", to).order("measured_at", { ascending: false }),
    db.from("symptom_logs").select("id, symptom, severity, started_at").eq("patient_account_id", acct.id).is("deleted_at", null)
      .gte("started_at", from).lt("started_at", to).order("started_at", { ascending: false }),
    db.from("dose_events").select("id, due_at, status, medication_schedules!inner(name, dose, active)").eq("patient_account_id", acct.id)
      .eq("medication_schedules.active", true).gte("due_at", from).lt("due_at", to).order("due_at"),
    db.from("notifications").select("id, type, title, body, created_at, read_at, link").eq("user_id", c.userId)
      .or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`).order("created_at", { ascending: false }).limit(5),
  ]);
  let next = null;
  if (acct.patient_id) {
    const { data: appt } = await db.from("appointments").select("id, slot_start, token_no, status, doctor_id, department_id")
      .eq("patient_id", acct.patient_id).gte("slot_start", new Date(Date.now() - 3600e3).toISOString())
      .in("status", ["booked", "waiting", "checked_in", "needs_rebooking"]).order("slot_start").limit(1).maybeSingle();
    if (appt) {
      const { data: doc } = await db.from("doctors").select("user_id").eq("id", appt.doctor_id).maybeSingle();
      const [{ data: dp }, { data: dept }] = await Promise.all([
        doc ? db.from("profiles").select("full_name").eq("id", doc.user_id).maybeSingle() : Promise.resolve({ data: null }),
        appt.department_id ? db.from("departments").select("name").eq("id", appt.department_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      next = { ...appt, doctor_name: dp?.full_name ?? null, department_name: dept?.name ?? null };
    }
  }
  return json({ ok: true, data: {
    name: prof?.full_name ?? null, readings: readings ?? [], symptoms: symptoms ?? [],
    // deno-lint-ignore no-explicit-any
    doses: (doses ?? []).map((d: any) => ({ id: d.id, due_at: d.due_at, status: d.status, name: d.medication_schedules?.name, dose: d.medication_schedules?.dose })),
    next_appointment: next, alerts: alerts ?? [],
  } });
});
