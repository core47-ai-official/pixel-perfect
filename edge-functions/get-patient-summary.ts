// Paste into Supabase → Edge Functions → new function "get-patient-summary". Turn "Enforce JWT Verification" OFF.
// Input: { patient_id }. Any hospital staff (not patients).
// Returns: { patient, active_admission, recent_visits (last 10), open_bills, balance_due, payer_type }
// Visits / admissions / bills tables don't exist yet; until they do, those parts come back empty.
// Expected later: admissions(patient_id, status 'active', admitted_at, ward, bed),
//                 visits(patient_id, visit_date, doctor_id, department_id, type, status),
//                 invoices (open / partly_paid) — bill_no is the invoice number.
// Bill amounts are hidden from roles that shouldn't see billing (nurse, lab_tech, ot_coordinator).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
const BILLING_ROLES = ["super_admin", "admin", "cashier", "receptionist", "dept_head", "doctor", "er_officer", "pharmacist"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return fail("unauthorized", "Please sign in again.", 401);
  let userId = u.user.id;
  const impId = req.headers.get("x-impersonation-session");
  if (impId) {
    const { data: s } = await db.from("impersonation_sessions").select("*").eq("id", impId).maybeSingle();
    if (!s || s.super_admin_id !== userId || s.ended_at || new Date(s.expires_at) < new Date())
      return fail("forbidden", "Acting session is not active.", 403);
    userId = s.target_user_id;
  }
  const { data: prof } = await db.from("profiles").select("hospital_id, is_active").eq("id", userId).maybeSingle();
  if (!prof?.is_active) return fail("forbidden", "Account is not active.", 403);
  const hospitalId = prof.hospital_id;
  const { data: rolesRows } = await db.from("user_roles").select("role").eq("user_id", userId).eq("hospital_id", hospitalId);
  const roles = (rolesRows ?? []).map((r) => r.role as string);
  if (!roles.some((r) => r !== "patient")) return fail("forbidden", "Staff only.", 403);

  const body = await req.json().catch(() => ({}));
  const { data: patient } = await db.from("patients").select("*")
    .eq("id", String(body.patient_id ?? "")).eq("hospital_id", hospitalId).maybeSingle();
  if (!patient) return fail("not_found", "Patient not found.", 404);

  // Optional tables: a missing table returns an error, which we treat as "nothing yet".
  const safe = async <T>(p: PromiseLike<{ data: T | null; error: unknown }>, fallback: T): Promise<T> => {
    try { const { data, error } = await p; return error || data == null ? fallback : data; } catch { return fallback; }
  };

  const [admission, visits, bills] = await Promise.all([
    safe(db.from("admissions").select("id, admitted_at, bed_id, beds(label, wards(name))").eq("hospital_id", hospitalId).eq("patient_id", patient.id)
      .eq("status", "admitted").order("admitted_at", { ascending: false }).limit(1).maybeSingle()
      // deno-lint-ignore no-explicit-any
      .then((r: any) => r.data ? { data: { id: r.data.id, admitted_at: r.data.admitted_at, bed: r.data.beds?.label, ward: r.data.beds?.wards?.name } } : r), null),
    safe(db.from("visits").select("*").eq("hospital_id", hospitalId).eq("patient_id", patient.id)
      .order("visit_date", { ascending: false }).limit(10), [] as Record<string, unknown>[]),
    roles.some((r) => BILLING_ROLES.includes(r))
      ? safe(db.from("invoices").select("id, bill_no:invoice_no, total, discount, paid, balance, status, payer_type, created_at").eq("hospital_id", hospitalId)
          .eq("patient_id", patient.id).in("status", ["open", "partly_paid"]).order("created_at", { ascending: false }), [] as Record<string, unknown>[])
      : Promise.resolve(null),
  ]);

  const balance = bills ? Math.round(bills.reduce((s, b) => s + Number(b.balance ?? 0), 0) * 100) / 100 : null;
  return json({ ok: true, data: {
    patient, active_admission: admission, recent_visits: visits,
    open_bills: bills, balance_due: balance, payer_type: (bills?.[0] as { payer_type?: string } | undefined)?.payer_type ?? "self",
  } });
});
