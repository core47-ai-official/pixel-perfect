// Paste into Supabase → Edge Functions → new function "get-ward-board". Turn "Enforce JWT Verification" OFF.
// Nurse ward board. Body: { ward_id? }. Nurses see only their assigned wards (user_roles.ward_ids); admins, dept heads, doctors see all. Patient details appear once admissions (B19) exist.
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
const READERS = ["super_admin", "admin", "dept_head", "doctor", "nurse", "er_officer"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => READERS.includes(r))) return fail("forbidden", "You can't see the ward board.", 403);
  const b = await req.json().catch(() => ({}));
  const { data: settings } = await db.from("company_settings").select("wards").eq("hospital_id", c.hospitalId).maybeSingle();
  const dueHours = Math.min(Math.max(Number(settings?.wards?.vitals_interval_hours ?? 4) || 4, 1), 24);
  let wq = db.from("wards").select("id, name, type, gender, floor").eq("hospital_id", c.hospitalId).eq("is_active", true).order("name");
  const onlyNurse = !c.roles.some((r) => READERS.filter((x) => x !== "nurse").includes(r));
  let assigned: string[] = [];
  if (onlyNurse) {
    const { data: rr } = await db.from("user_roles").select("ward_ids").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).eq("role", "nurse");
    assigned = [...new Set((rr ?? []).flatMap((x: { ward_ids: string[] }) => x.ward_ids ?? []))];
    if (!assigned.length) return json({ ok: true, data: { wards: [], beds: [], due_hours: dueHours, assigned: false } });
    wq = wq.in("id", assigned);
  }
  if (b.ward_id) wq = wq.eq("id", String(b.ward_id));
  const { data: wards } = await wq;
  const ids = (wards ?? []).map((w: { id: string }) => w.id);
  if (!ids.length) return json({ ok: true, data: { wards: [], beds: [], due_hours: dueHours, assigned: true } });
  const { data: beds } = await db.from("beds").select("id, ward_id, label, status, current_admission_id, has_oxygen, has_ventilator").in("ward_id", ids);
  // Admissions arrive in B19; tolerate the table not existing yet.
  const admIds = (beds ?? []).map((x: { current_admission_id: string | null }) => x.current_admission_id).filter(Boolean);
  // deno-lint-ignore no-explicit-any
  let adms: any[] = [];
  if (admIds.length) {
    const r = await db.from("admissions").select("id, patient_id, admitted_at").in("id", admIds);
    if (!r.error) adms = r.data ?? [];
  }
  const pids = adms.map((a) => a.patient_id);
  // deno-lint-ignore no-explicit-any
  let pats: any[] = [], vit: any[] = [];
  if (pids.length) {
    pats = (await db.from("patients").select("id, mrn, full_name, gender, dob, allergies").in("id", pids)).data ?? [];
    vit = (await db.from("vitals").select("*").in("patient_id", pids).order("recorded_at", { ascending: false }).limit(pids.length * 5)).data ?? [];
  }
  const now = Date.now();
  const out = (beds ?? []).map((bed: Record<string, unknown>) => {
    const a = adms.find((x) => x.id === bed.current_admission_id);
    const p = a ? pats.find((x) => x.id === a.patient_id) : null;
    const v = p ? vit.find((x) => x.patient_id === p.id) ?? null : null;
    const last = v ? new Date(v.recorded_at).getTime() : a ? new Date(a.admitted_at).getTime() : null;
    return {
      ...bed, admission_id: a?.id ?? null, admitted_at: a?.admitted_at ?? null,
      days_admitted: a ? Math.max(1, Math.ceil((now - new Date(a.admitted_at).getTime()) / 86400000)) : null,
      patient: p, latest_vitals: v,
      vitals_due_at: last ? new Date(last + dueHours * 3600000).toISOString() : null,
    };
  });
  return json({ ok: true, data: { wards, beds: out, due_hours: dueHours, assigned: true } });
});
