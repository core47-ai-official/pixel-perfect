// Paste into Supabase → Edge Functions → new function "get-patient-portal-home". Turn "Enforce JWT Verification" OFF.
// Input: {} → the signed-in patient's portal Home in one call:
//   { linked, patient, next_appointment, latest_reports[3], balance_due, open_bills, settings: { allow_patient_booking, cancellation_hours, booking_window_days } }
// Allowed: patient accounts (own linked record only).
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


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.includes("patient")) return fail("forbidden", "Patient accounts only.", 403);

  const [{ data: patient }, { data: cs }] = await Promise.all([
    db.from("patients").select("id, full_name, mrn, print_language").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).maybeSingle(),
    db.from("company_settings").select("appointments").eq("hospital_id", c.hospitalId).maybeSingle(),
  ]);
  const a = (cs?.appointments ?? {}) as Record<string, unknown>;
  const settings = {
    allow_patient_booking: a.allow_patient_booking === true,
    cancellation_hours: Number(a.cancellation_hours ?? 2),
    booking_window_days: Number(a.booking_window_days ?? 30),
  };
  if (!patient) return json({ ok: true, data: { linked: false, settings } });

  const [{ data: appt }, { data: reports }, { data: bills }] = await Promise.all([
    db.from("appointments").select("id, slot_start, token_no, status, doctor_id, department_id")
      .eq("patient_id", patient.id).gte("slot_start", new Date(Date.now() - 3600_000).toISOString())
      .in("status", ["booked", "waiting", "checked_in", "needs_rebooking"]).order("slot_start").limit(1).maybeSingle(),
    db.from("orders").select("id, verified_at, has_critical, lab_tests(name)").eq("patient_id", patient.id).eq("status", "verified")
      .order("verified_at", { ascending: false }).limit(3),
    db.from("invoices").select("balance").eq("patient_id", patient.id).in("status", ["open", "partly_paid"]),
  ]);
  let next = null;
  if (appt) {
    const { data: doc } = await db.from("doctors").select("user_id").eq("id", appt.doctor_id).maybeSingle();
    const [{ data: dp }, { data: dept }] = await Promise.all([
      doc ? db.from("profiles").select("full_name").eq("id", doc.user_id).maybeSingle() : Promise.resolve({ data: null }),
      appt.department_id ? db.from("departments").select("name").eq("id", appt.department_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    next = { ...appt, doctor_name: dp?.full_name ?? null, department_name: dept?.name ?? null };
  }
  const balance = (bills ?? []).reduce((s, b) => s + Number(b.balance ?? 0), 0);
  return json({ ok: true, data: {
    linked: true, patient, next_appointment: next, settings,
    latest_reports: (reports ?? []).map((r) => ({ id: r.id, verified_at: r.verified_at, has_critical: r.has_critical, test_name: (r.lab_tests as { name?: string } | null)?.name ?? null })),
    balance_due: Math.round(balance * 100) / 100, open_bills: (bills ?? []).filter((b) => Number(b.balance) > 0).length,
  } });
});
