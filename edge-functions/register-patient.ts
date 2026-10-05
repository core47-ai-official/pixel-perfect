// Paste into Supabase → Edge Functions → new function "register-patient". Turn "Enforce JWT Verification" OFF.
// Allowed: receptionist, er_officer, admin, super_admin.
// Input: patient fields (see clean()) + optional { confirm_duplicate: true } to save even though the CNIC is already on file.
// Assigns MRN-YYYY-000001 from the hospital's "mrn" counter (safe against two people saving at once).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);

// ---------- shared validation (identical in update-patient) ----------
const PROVINCES = ["punjab", "sindh", "kpk", "balochistan", "islamabad", "gb", "ajk"];
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const GENDERS = ["male", "female", "other"];
const PREG = ["not_applicable", "not_pregnant", "pregnant", "unknown"];
const LANGS = ["en", "ur"];
const str = (v: unknown, max: number) => { const s = String(v ?? "").trim(); return s ? s.slice(0, max) : null; };
const list = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(","))
  .map((x) => String(x).trim()).filter(Boolean).slice(0, 30).map((x) => x.slice(0, 80));
function fmtCnic(v: unknown) {
  const d = String(v ?? "").replace(/\D/g, "");
  if (!d) return { ok: true as const, value: null };
  if (d.length !== 13) return { ok: false as const };
  return { ok: true as const, value: `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}` };
}
function fmtPhone(v: unknown) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (!d) return { ok: true as const, value: null };
  if (d.startsWith("92")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (!/^3\d{9}$/.test(d)) return { ok: false as const };
  return { ok: true as const, value: `+92 ${d.slice(0, 3)} ${d.slice(3)}` };
}
function clean(b: Record<string, unknown>): { error: string } | { data: Record<string, unknown> } {
  const isUnknown = b.is_unknown === true;
  const full_name = str(b.full_name, 120);
  if (!full_name || full_name.length < 2) return { error: "Full name is required." };
  const cnic = fmtCnic(b.cnic);
  if (!cnic.ok) return { error: "CNIC must be 13 digits (XXXXX-XXXXXXX-X)." };
  const bform = fmtCnic(b.b_form);
  if (!bform.ok) return { error: "B-form number must be 13 digits." };
  const phone = fmtPhone(b.phone);
  if (!phone.ok) return { error: "Phone must be a Pakistani mobile number (03XX XXXXXXX)." };
  const gphone = fmtPhone(b.guardian_phone);
  if (!gphone.ok) return { error: "Guardian phone must be a Pakistani mobile number." };
  const email = str(b.email, 255);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Email address is not valid." };
  const dob = str(b.dob, 10);
  if (dob) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(Date.parse(dob))) return { error: "Date of birth is not valid." };
    if (dob > new Date().toISOString().slice(0, 10)) return { error: "Date of birth can't be in the future." };
    if (dob < "1900-01-01") return { error: "Date of birth is too far in the past." };
  }
  const gender = str(b.gender, 10);
  if (!isUnknown && !gender) return { error: "Gender is required." };
  if (gender && !GENDERS.includes(gender)) return { error: "Unknown gender." };
  const province = str(b.province, 20);
  if (province && !PROVINCES.includes(province)) return { error: "Unknown province." };
  const blood = str(b.blood_group, 3);
  if (blood && !BLOOD.includes(blood)) return { error: "Unknown blood group." };
  const preg = str(b.pregnancy_status, 20);
  if (preg && !PREG.includes(preg)) return { error: "Unknown pregnancy status." };
  if (preg === "pregnant" && gender === "male") return { error: "Pregnancy status doesn't match gender." };
  const pl = str(b.print_language, 5);
  if (pl && !LANGS.includes(pl)) return { error: "Unknown print language." };
  if (!isUnknown && !dob) return { error: "Date of birth is required (an estimate is fine)." };
  return { data: {
    full_name, cnic: cnic.value, b_form: bform.value, father_or_husband_name: str(b.father_or_husband_name, 120),
    dob, gender, phone: phone.value, email, guardian_name: str(b.guardian_name, 120), guardian_phone: gphone.value,
    province, district: str(b.district, 60), tehsil: str(b.tehsil, 60), address: str(b.address, 300),
    blood_group: blood, allergies: list(b.allergies), chronic_conditions: list(b.chronic_conditions),
    pregnancy_status: preg, print_language: pl, is_unknown: isUnknown,
  } };
}
// --------------------------------------------------------------------

async function nextMrn(db: ReturnType<typeof createClient>, hospitalId: string) {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: c } = await db.from("counters").select("id, next_value").eq("hospital_id", hospitalId).eq("key", "mrn").maybeSingle();
    if (!c) {
      const { error } = await db.from("counters").insert({ hospital_id: hospitalId, key: "mrn", prefix: "MRN-", next_value: 1, reset_rule: "never" });
      if (error && error.code !== "23505") throw error;
      continue;
    }
    // Compare-and-swap: only succeeds if nobody else took this number first.
    const { data: won } = await db.from("counters")
      .update({ next_value: c.next_value + 1, updated_at: new Date().toISOString() })
      .eq("id", c.id).eq("next_value", c.next_value).select("id");
    if (won?.length) return `MRN-${year}-${String(c.next_value).padStart(6, "0")}`;
  }
  throw new Error("Couldn't assign an MRN, please try again.");
}

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
  const hospitalId = prof.hospital_id;
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId).eq("hospital_id", hospitalId);
  if (!(roles ?? []).some((r) => ["receptionist", "er_officer", "admin", "super_admin"].includes(r.role)))
    return fail("forbidden", "You can't register patients.", 403);

  const body = await req.json().catch(() => ({}));
  const c = clean(body);
  if ("error" in c) return fail("validation", c.error);

  if (c.data.cnic && body.confirm_duplicate !== true) {
    const { data: same } = await db.from("patients").select("id, mrn, full_name")
      .eq("hospital_id", hospitalId).eq("cnic", c.data.cnic).is("merged_into", null).limit(1);
    if (same?.length) return fail("duplicate", `A patient with this CNIC is already registered (${same[0].mrn}, ${same[0].full_name}).`, 409);
  }

  let mrn: string;
  try { mrn = await nextMrn(db, hospitalId); } catch (e) { return fail("counter", (e as Error).message, 500); }

  const { data: row, error } = await db.from("patients")
    .insert({ ...c.data, hospital_id: hospitalId, mrn, created_by: userId }).select().single();
  if (error) return fail("db", error.message);

  await db.from("audit_logs").insert({
    hospital_id: hospitalId, user_id: userId, impersonated_by: impersonatedBy,
    action: "create", resource: "patient", resource_id: row.id, before: null, after: row,
    ip: req.headers.get("x-forwarded-for"),
  });
  return json({ ok: true, data: row });
});
