// Paste into Supabase → Edge Functions → new function "save-tracker-onboarding". Turn "Enforce JWT Verification" OFF.
// Patient only. One call at the end of onboarding; writes profile + conditions + medicines, undoing everything if any step fails.
// Body: { dob, gender, height_cm, weight_kg, blood_group?, emergency_contact {name, relation, phone}, health_status, conditions: [{name}], medicines: [{name, dose}], consent: true, disclaimer: true }
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
const GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const txt = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!c.roles.includes("patient") || c.impersonatedBy) return fail("forbidden", "Only the patient can set up their health tracker.", 403);
  const { data: acct } = await db.from("patient_accounts").select("id, patient_id").eq("user_id", c.userId).maybeSingle();
  if (!acct) return fail("not_found", "Patient account not found.", 404);
  const { data: existing } = await db.from("tracker_profiles").select("id, onboarding_done").eq("patient_account_id", acct.id).maybeSingle();
  if (existing?.onboarding_done) return json({ ok: true, data: { already: true } });

  if (b.consent !== true || b.disclaimer !== true) return fail("invalid", "Please accept the consent and emergency notice.");
  const dob = txt(b.dob, 10);
  const d = new Date(dob + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(d.getTime()) || d > new Date() || d.getUTCFullYear() < 1900) return fail("invalid", "Enter a valid date of birth.");
  const gender = ["male", "female", "other"].includes(String(b.gender)) ? String(b.gender) : null;
  if (!gender) return fail("invalid", "Choose a gender.");
  const height = Number(b.height_cm), weight = Number(b.weight_kg);
  if (!(height >= 30 && height <= 260)) return fail("invalid", "Height must be between 30 and 260 cm.");
  if (!(weight >= 1 && weight <= 400)) return fail("invalid", "Weight must be between 1 and 400 kg.");
  const blood = b.blood_group ? String(b.blood_group) : null;
  if (blood && !GROUPS.includes(blood)) return fail("invalid", "Unknown blood group.");
  const ec = b.emergency_contact ?? {};
  const contact = { name: txt(ec.name, 100), relation: txt(ec.relation, 50), phone: txt(ec.phone, 20) };
  if (contact.phone && !/^[0-9+\- ]{7,20}$/.test(contact.phone)) return fail("invalid", "Emergency contact phone looks wrong.");
  const status = b.health_status === "has_conditions" ? "has_conditions" : "none";
  const conds = status === "has_conditions" ? [...new Set((Array.isArray(b.conditions) ? b.conditions : []).map((x: { name?: unknown }) => txt(x?.name, 120)).filter(Boolean))].slice(0, 50) : [];
  if (status === "has_conditions" && !conds.length) return fail("invalid", "Pick at least one condition.");
  const meds = (Array.isArray(b.medicines) ? b.medicines : []).map((m: { name?: unknown; dose?: unknown }) => ({ name: txt(m?.name, 120), dose: txt(m?.dose, 60) || null }))
    .filter((m: { name: string }) => m.name).slice(0, 30);

  const now = new Date().toISOString();
  const profile = { patient_account_id: acct.id, patient_id: acct.patient_id, dob, gender, height_cm: height, weight_kg: weight, blood_group: blood,
    emergency_contact: contact, health_status: status, onboarding_done: true, consented_at: now, disclaimer_ack_at: now, updated_at: now };
  const made: { table: string; ids: string[] }[] = [];
  const undo = async () => {
    for (const m of made) if (m.ids.length) await db.from(m.table).delete().in("id", m.ids);
    if (existing) await db.from("tracker_profiles").update({ onboarding_done: false }).eq("id", existing.id);
  };
  try {
    if (conds.length) {
      const { data, error } = await db.from("tracker_conditions").insert(conds.map((name) => ({ patient_account_id: acct.id, patient_id: acct.patient_id, name, source: "patient" }))).select("id");
      if (error) throw error; made.push({ table: "tracker_conditions", ids: data.map((r: { id: string }) => r.id) });
    }
    if (meds.length) {
      const { data, error } = await db.from("medication_schedules").insert(meds.map((m: { name: string; dose: string | null }) => ({ patient_account_id: acct.id, patient_id: acct.patient_id, name: m.name, dose: m.dose }))).select("id");
      if (error) throw error; made.push({ table: "medication_schedules", ids: data.map((r: { id: string }) => r.id) });
    }
    if (existing) {
      const { error } = await db.from("tracker_profiles").update(profile).eq("id", existing.id).eq("onboarding_done", false);
      if (error) throw error;
    } else {
      const { data, error } = await db.from("tracker_profiles").insert(profile).select("id").single();
      if (error) throw error; made.push({ table: "tracker_profiles", ids: [data.id] });
    }
  } catch (_e) {
    await undo();
    return fail("server", "Couldn't save your health profile. Nothing was saved — please try again.", 500);
  }
  await audit(db, req, c, "tracker.onboarding", "tracker_profiles", acct.id, null, { health_status: status, conditions: conds.length, medicines: meds.length });
  return json({ ok: true, data: { done: true } });
});
