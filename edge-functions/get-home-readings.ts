// Paste into Supabase → Edge Functions → new function "get-home-readings". Turn "Enforce JWT Verification" OFF.
// Doctor only. Body: { patient_id }. Returns 14 days of shared home data, or { shared: false } with nothing else.
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

// ---- doctor ↔ patient link (identical in get-home-readings and set-target-range) ----
async function myDoctor(db: DB, c: DB) {
  const { data } = await db.from("doctors").select("id, user_id, hospital_id").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).maybeSingle();
  return data as { id: string; user_id: string; hospital_id: string } | null;
}
/** The active connection between this doctor and the hospital patient, or null. Never reveals whether the patient has an account. */
async function activeLink(db: DB, doctorId: string, hospitalId: string, patientId: string) {
  const { data: pa } = await db.from("patient_accounts").select("id, user_id, hospital_id").eq("patient_id", patientId).eq("hospital_id", hospitalId).maybeSingle();
  if (!pa) return null;
  const { data: cn } = await db.from("connections").select("*").eq("patient_account_id", pa.id).eq("doctor_id", doctorId).eq("status", "active").maybeSingle();
  return cn ? { account: pa, conn: cn } : null;
}
const allowed = (cn: DB, k: string) => cn?.permissions?.[k] !== false && cn?.permissions?.[k] !== "false";
// ---- end link ----
const TYPES = ["bp", "glucose", "weight", "pulse"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const doc = await myDoctor(db, c);
  if (!doc) return fail("forbidden", "Only doctors can view home readings.", 403);
  const link = await activeLink(db, doc.id, c.hospitalId, String(b.patient_id ?? ""));
  const empty = { shared: false };
  if (!link) return json({ ok: true, data: empty });
  const cn = link.conn, acct = link.account.id;
  const perm = { measurements: allowed(cn, "measurements"), medicines: allowed(cn, "medicines"), symptoms: allowed(cn, "symptoms") };
  if (!perm.measurements && !perm.medicines && !perm.symptoms) return json({ ok: true, data: empty });
  const since = new Date(Date.now() - 14 * 86400e3).toISOString();
  const [m, s, d, sy, prof] = await Promise.all([
    perm.measurements ? db.from("measurements").select("type, value_1, value_2, unit, measured_at").eq("patient_account_id", acct).is("deleted_at", null).in("type", TYPES).gte("measured_at", since).order("measured_at") : { data: null },
    perm.medicines ? db.from("medication_schedules").select("id, name, dose, active").eq("patient_account_id", acct) : { data: null },
    perm.medicines ? db.from("dose_events").select("schedule_id, status, due_at").eq("patient_account_id", acct).gte("due_at", since).lte("due_at", new Date().toISOString()) : { data: null },
    perm.symptoms ? db.from("symptom_logs").select("symptom, severity, started_at, notes").eq("patient_account_id", acct).is("deleted_at", null).gte("started_at", since).order("started_at", { ascending: false }).limit(10) : { data: null },
    db.from("tracker_profiles").select("targets").eq("patient_account_id", acct).maybeSingle(),
  ]);
  let adherence = null;
  if (perm.medicines) {
    const names = new Map((s.data ?? []).map((x: DB) => [x.id, x]));
    const by = new Map<string, { taken: number; total: number }>();
    for (const e of d.data ?? []) {
      const r = by.get(e.schedule_id) ?? { taken: 0, total: 0 };
      r.total++; if (e.status === "taken") r.taken++;
      by.set(e.schedule_id, r);
    }
    const per = [...by.entries()].map(([id, r]) => ({ name: (names.get(id) as DB)?.name ?? "—", dose: (names.get(id) as DB)?.dose ?? null, taken: r.taken, total: r.total, pct: r.total ? Math.round((r.taken / r.total) * 100) : null }));
    const T = per.reduce((a, r) => a + r.total, 0), K = per.reduce((a, r) => a + r.taken, 0);
    adherence = { overall: T ? Math.round((K / T) * 100) : null, medicines: per };
  }
  await audit(db, req, c, "tracker.view_home_readings", "connections", cn.id, null, null);
  return json({ ok: true, data: { shared: true, connection_id: cn.id, shared_at: cn.shared_at ?? cn.responded_at ?? cn.created_at, followup_on: cn.followup_on,
    permissions: perm, measurements: m.data, adherence, symptoms: sy.data, targets: perm.measurements ? (prof.data?.targets ?? {}) : {} } });
});
