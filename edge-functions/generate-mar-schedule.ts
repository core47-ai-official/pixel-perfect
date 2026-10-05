// Paste into Supabase → Edge Functions → new function "generate-mar-schedule". Turn "Enforce JWT Verification" OFF.
// Builds the ward medication schedule (MAR) for a prescription when the patient is admitted. Body: { prescription_id }
// Called by save-prescription after every save; safe to call again (replaces future, not-yet-recorded doses).
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

const ROLES = ["super_admin", "admin", "dept_head", "doctor", "nurse"];
const PK = 5 * 3600e3;
const HOURS: Record<string, number[]> = { OD: [8], BD: [8, 20], TDS: [8, 14, 20], QID: [8, 12, 16, 20], HS: [21] };
/** Dose hours (Pakistan time) for a frequency; [] = as needed, null = once now. */
function hoursFor(freq: string): number[] | null {
  const f = freq.trim().toUpperCase();
  if (f === "SOS" || f === "PRN") return [];
  if (f === "STAT") return null;
  if (HOURS[f]) return HOURS[f];
  const parts = f.split("+");
  if (parts.length >= 2 && parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
    const pos = parts.length === 4 ? [8, 12, 16, 20] : parts.length === 3 ? [8, 14, 20] : [8, 20];
    return parts.map((p, i) => (Number(p) > 0 ? pos[i] : -1)).filter((h) => h >= 0);
  }
  return [8];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ROLES)) return fail("forbidden", "Not allowed.", 403);
  const { data: rx } = await db.from("prescriptions").select("id, patient_id, created_at").eq("id", String(b.prescription_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!rx) return fail("not_found", "Prescription not found.", 404);
  const { data: adm } = await db.from("admissions").select("id").eq("hospital_id", c.hospitalId).eq("patient_id", rx.patient_id).eq("status", "admitted").maybeSingle();
  if (!adm) return json({ ok: true, data: { skipped: "not_admitted", created: 0 } });
  const { data: items } = await db.from("prescription_items").select("*").eq("prescription_id", rx.id);
  const nowMs = Date.now();
  // Drop future doses not yet recorded; recorded history always stays.
  await db.from("med_administrations").delete().eq("prescription_id", rx.id).eq("status", "scheduled").gte("scheduled_at", new Date(nowMs).toISOString());
  const { data: past } = await db.from("med_administrations").select("medicine_name, scheduled_at").eq("prescription_id", rx.id);
  const rows = [];
  for (const it of items ?? []) {
    const base = { hospital_id: c.hospitalId, admission_id: adm.id, patient_id: rx.patient_id, prescription_id: rx.id, prescription_item_id: it.id,
      medicine_name: it.medicine_name, dose: it.dose ?? "", route: it.route ?? "", status: "scheduled" };
    const hrs = hoursFor(String(it.frequency ?? ""));
    if (hrs === null) {
      if (!(past ?? []).some((p: { medicine_name: string }) => p.medicine_name === it.medicine_name)) rows.push({ ...base, scheduled_at: new Date(nowMs).toISOString() });
      continue;
    }
    const days = Math.min(Math.max(Number(it.duration_days) || 7, 1), 30);
    const startDay = new Date(new Date(rx.created_at).getTime() + PK).toISOString().slice(0, 10);
    for (let d = 0; d < days; d++) for (const h of hrs) {
      const at = Date.parse(`${startDay}T00:00:00Z`) + d * 86400e3 + h * 3600e3 - PK;
      if (at < nowMs) continue;
      rows.push({ ...base, scheduled_at: new Date(at).toISOString() });
    }
  }
  if (rows.length) {
    const { error } = await db.from("med_administrations").upsert(rows, { onConflict: "prescription_item_id,scheduled_at", ignoreDuplicates: true });
    if (error) return fail("server", "Could not build the medication schedule.", 500);
  }
  await audit(db, req, c, "generate", "mar_schedule", rx.id, null, { admission_id: adm.id, doses: rows.length });
  return json({ ok: true, data: { admission_id: adm.id, created: rows.length } });
});
