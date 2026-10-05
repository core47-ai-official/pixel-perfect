// Paste into Supabase → Edge Functions → new function "record-vitals". Turn "Enforce JWT Verification" OFF.
// Nurse/doctor/ER: records vitals with range checks.
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

const CLINICAL = ["doctor", "dept_head", "nurse", "er_officer"];

/** The caller's doctor row (null if the caller isn't a doctor). */
async function myDoctor(db: DB, c: { userId: string; hospitalId: string }) {
  const { data } = await db.from("doctors").select("id, specialty").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).maybeSingle();
  return data as { id: string; specialty: string } | null;
}

// deno-lint-ignore no-explicit-any
async function audit(db: DB, req: Request, c: any, action: string, resource: string, id: string, before: unknown, after: unknown) {
  await db.from("audit_logs").insert({
    hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action,
    resource, resource_id: id, before, after, ip: req.headers.get("x-forwarded-for"),
  });
}
const clip = (v: unknown, n = 20000) => String(v ?? "").slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  const b = await req.json().catch(() => ({}));
  if (!c.roles.some((r) => CLINICAL.includes(r))) return fail("forbidden", "Only nurses and doctors can record vitals.", 403);
  const { data: p } = await db.from("patients").select("id").eq("id", String(b.patient_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!p) return fail("not_found", "Patient not found.", 404);
  let visitId: string | null = null;
  if (b.visit_id) {
    const { data: v } = await db.from("visits").select("id").eq("id", String(b.visit_id)).eq("patient_id", p.id).maybeSingle();
    visitId = v?.id ?? null;
  }
  // Plausible ranges; anything outside is rejected as a typo.
  const R: Record<string, [number, number, boolean]> = {
    bp_sys: [40, 300, true], bp_dia: [20, 200, true], pulse: [20, 250, true], temp_c: [30, 45, false],
    spo2: [40, 100, true], weight_kg: [0.3, 400, false], height_cm: [20, 250, false], rr: [4, 80, true],
  };
  const row: Record<string, unknown> = {};
  for (const [k, [lo, hi, int]] of Object.entries(R)) {
    if (b[k] === undefined || b[k] === null || b[k] === "") continue;
    const n = Number(b[k]);
    if (!isFinite(n) || n < lo || n > hi) return fail("validation", `${k} looks wrong (${lo}–${hi}).`);
    row[k] = int ? Math.round(n) : Math.round(n * 10) / 10;
  }
  if (!Object.keys(row).length) return fail("validation", "Enter at least one reading.");
  const { data: saved, error } = await db.from("vitals").insert({
    ...row, hospital_id: c.hospitalId, patient_id: p.id, visit_id: visitId, recorded_by: c.userId, created_by: c.userId,
  }).select().single();
  if (error) return fail("server", "Couldn't save vitals.", 500);
  await audit(db, req, c, "record", "vitals", saved.id, null, saved);
  return json({ ok: true, data: saved });
});
