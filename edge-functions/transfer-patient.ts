// Paste into Supabase → Edge Functions → new function "transfer-patient". Turn "Enforce JWT Verification" OFF.
// Move an admitted patient to another bed. Body: { admission_id, to_bed_id, reason }. Old bed → cleaning, new bed → occupied.
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
  if (!has(c, ["super_admin", "admin", "dept_head", "doctor", "nurse"])) return fail("forbidden", "You can't transfer patients.", 403);
  const reason = String(b.reason ?? "").trim().slice(0, 500);
  if (reason.length < 3) return fail("invalid", "Write the reason for transfer.");
  const { data: adm } = await db.from("admissions").select("*").eq("id", String(b.admission_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!adm || adm.status !== "admitted") return fail("not_found", "Active admission not found.", 404);
  if (adm.bed_id === b.to_bed_id) return fail("invalid", "Choose a different bed.");
  const { data: p } = await db.from("patients").select("gender").eq("id", adm.patient_id).single();
  const bed = await bedWithWard(db, c.hospitalId, String(b.to_bed_id ?? ""));
  if (!bed || !bed.wards.is_active) return fail("not_found", "Bed not found.", 404);
  if (!genderOk(bed.wards.gender, p?.gender ?? null)) return fail("gender", "This ward doesn't match the patient's gender.", 409);
  const now = new Date().toISOString();
  const { data: occ } = await db.from("beds").update({ status: "occupied", current_admission_id: adm.id, updated_at: now }).eq("id", bed.id).eq("status", "free").select("id").maybeSingle();
  if (!occ) return fail("bed_taken", "That bed is no longer free.", 409);
  const transfers = [...(adm.transfers ?? []), { from_bed_id: adm.bed_id, to_bed_id: bed.id, at: now, by: c.userId, reason }];
  const { data: upd, error } = await db.from("admissions").update({ bed_id: bed.id, transfers, updated_at: now }).eq("id", adm.id).eq("status", "admitted").select().maybeSingle();
  if (error || !upd) {
    await db.from("beds").update({ status: "free", current_admission_id: null, updated_at: now }).eq("id", bed.id);
    return fail("stale", "Could not transfer. Please try again.", 409);
  }
  if (adm.bed_id) await db.from("beds").update({ status: "cleaning", current_admission_id: null, updated_at: now }).eq("id", adm.bed_id).eq("current_admission_id", adm.id);
  await audit(db, req, c, "transfer", "admission", adm.id, { bed_id: adm.bed_id }, { bed_id: bed.id, reason });
  return json({ ok: true, data: upd });
});
