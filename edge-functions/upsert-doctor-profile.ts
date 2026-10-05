// Paste into Supabase → Edge Functions → new function "upsert-doctor-profile". Turn "Enforce JWT Verification" OFF.
// Input: { user_id, department_id, specialty, gender, languages[], consultation_fee, followup_fee, pmdc_no, status }
// Requires admin or super_admin. Audit-logged. Also gives the person the "doctor" role in that department.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
const STATUSES = ["available", "in_opd", "in_surgery", "on_round", "on_leave", "off_duty"];
const GENDERS = ["male", "female", "other"];
const money = (v: unknown) => {
  const n = Math.round(Number(v ?? 0) * 100) / 100;
  return Number.isFinite(n) && n >= 0 && n < 1e10 ? n : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return fail("unauthorized", "Please sign in again.", 401);
  let userId = u.user.id;
  let impersonatedBy: string | null = null;
  const impId = req.headers.get("x-impersonation-session");
  if (impId) {
    const { data: s } = await db.from("impersonation_sessions").select("*").eq("id", impId).maybeSingle();
    if (!s || s.super_admin_id !== userId || s.ended_at || new Date(s.expires_at) < new Date())
      return fail("forbidden", "Acting session is not active.", 403);
    impersonatedBy = userId; userId = s.target_user_id;
  }
  const { data: prof } = await db.from("profiles").select("hospital_id, is_active").eq("id", userId).maybeSingle();
  if (!prof?.is_active) return fail("forbidden", "Account is not active.", 403);
  const { data: myRoles } = await db.from("user_roles").select("role").eq("user_id", userId).eq("hospital_id", prof.hospital_id);
  if (!(myRoles ?? []).some((r) => r.role === "super_admin" || r.role === "admin"))
    return fail("forbidden", "Only admins can manage doctors.", 403);
  const hospitalId = prof.hospital_id;

  const b = await req.json().catch(() => ({}));
  const docUser = String(b.user_id ?? "");
  const deptId = String(b.department_id ?? "");
  const fee = money(b.consultation_fee);
  const fu = money(b.followup_fee);
  const status = String(b.status ?? "off_duty");
  const gender = b.gender ? String(b.gender) : null;
  const languages = Array.isArray(b.languages) ? b.languages.map(String).filter(Boolean).slice(0, 10) : ["en"];
  if (fee === null || fu === null) return fail("validation", "Fees must be valid amounts in PKR.");
  if (!STATUSES.includes(status)) return fail("validation", "Unknown status.");
  if (gender && !GENDERS.includes(gender)) return fail("validation", "Unknown gender.");

  const { data: target } = await db.from("profiles").select("id").eq("id", docUser).eq("hospital_id", hospitalId).maybeSingle();
  if (!target) return fail("not_found", "Staff member not found in this hospital.", 404);
  const { data: dept } = await db.from("departments").select("id").eq("id", deptId).eq("hospital_id", hospitalId).maybeSingle();
  if (!dept) return fail("validation", "Pick a department.");

  const { data: docRole } = await db.from("user_roles").select("id")
    .eq("user_id", docUser).eq("hospital_id", hospitalId).eq("role", "doctor").maybeSingle();
  if (docRole) await db.from("user_roles").update({ department_id: deptId }).eq("id", docRole.id);
  else await db.from("user_roles").insert({ user_id: docUser, hospital_id: hospitalId, role: "doctor", department_id: deptId, created_by: userId });

  const { data: before } = await db.from("doctors").select("*").eq("hospital_id", hospitalId).eq("user_id", docUser).maybeSingle();
  const values = {
    hospital_id: hospitalId, user_id: docUser, department_id: deptId,
    specialty: String(b.specialty ?? "").trim().slice(0, 120), gender, languages,
    consultation_fee: fee, followup_fee: fu, pmdc_no: b.pmdc_no ? String(b.pmdc_no).trim().slice(0, 30) : null,
    status, updated_at: new Date().toISOString(),
  };
  const { data: row, error } = before
    ? await db.from("doctors").update(values).eq("id", before.id).select().single()
    : await db.from("doctors").insert({ ...values, created_by: userId }).select().single();
  if (error) return fail("db", error.message);

  await db.from("audit_logs").insert({
    hospital_id: hospitalId, user_id: userId, impersonated_by: impersonatedBy,
    action: before ? "update" : "create", resource: "doctor", resource_id: row.id, before, after: row,
    ip: req.headers.get("x-forwarded-for"),
  });
  return json({ ok: true, data: row });
});
