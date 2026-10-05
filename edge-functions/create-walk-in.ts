// Paste into Supabase → Edge Functions → new function "create-walk-in". Turn "Enforce JWT Verification" OFF.
// Reception/admin: same-day visit with next token, straight into the waiting queue.
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

async function nextCounter(db: DB, hospitalId: string, key: string) {
  for (let i = 0; i < 10; i++) {
    const { data: c } = await db.from("counters").select("id, next_value").eq("hospital_id", hospitalId).eq("key", key).maybeSingle();
    if (!c) {
      const { error } = await db.from("counters").insert({ hospital_id: hospitalId, key, prefix: "", next_value: 1, reset_rule: "daily" });
      if (error && error.code !== "23505") throw error;
      continue;
    }
    const { data: won } = await db.from("counters").update({ next_value: c.next_value + 1, updated_at: new Date().toISOString() })
      .eq("id", c.id).eq("next_value", c.next_value).select("id");
    if (won?.length) return c.next_value as number;
  }
  throw new Error("Couldn't assign a token, please try again.");
}

const localDate = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 10);
const todayPk = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

/** Tells waiting-room TVs to refresh (Realtime broadcast; carries no patient data). */
async function refreshTv(db: DB, hospitalId: string) {
  try {
    const ch = db.channel(`tv-${hospitalId}`);
    await ch.send({ type: "broadcast", event: "refresh", payload: { at: Date.now() } });
    await db.removeChannel(ch);
  } catch { /* TVs also poll every 15 s */ }
}

// deno-lint-ignore no-explicit-any
async function audit(db: DB, req: Request, c: any, action: string, id: string, before: unknown, after: unknown) {
  await db.from("audit_logs").insert({
    hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action,
    resource: "appointment", resource_id: id, before, after, ip: req.headers.get("x-forwarded-for"),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => ["receptionist", "admin", "super_admin"].includes(r))) return fail("forbidden", "Only reception can add walk-ins.", 403);
  const b = await req.json().catch(() => ({}));
  const type = ["new", "follow_up", "procedure"].includes(b.type) ? b.type : "new";
  const [{ data: patient }, { data: doc }, { data: settings }] = await Promise.all([
    db.from("patients").select("id, merged_into").eq("id", String(b.patient_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle(),
    db.from("doctors").select("*").eq("id", String(b.doctor_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle(),
    db.from("company_settings").select("appointments, opd").eq("hospital_id", c.hospitalId).maybeSingle(),
  ]);
  if (!patient) return fail("not_found", "Patient not found.", 404);
  if (patient.merged_into) return fail("validation", "This record was merged into another patient.");
  if (!doc) return fail("not_found", "Doctor not found.", 404);
  if (settings?.appointments?.allow_walk_ins === false) return fail("forbidden", "Walk-ins are turned off in company settings.", 403);
  const day = todayPk();
  const { data: leave } = await db.from("doctor_leaves").select("id").eq("doctor_id", doc.id).eq("status", "approved")
    .lte("from_date", day).gte("to_date", day).limit(1);
  if (leave?.length) return fail("validation", "The doctor is on leave today.");
  const { data: dup } = await db.from("appointments").select("id").eq("patient_id", patient.id).eq("doctor_id", doc.id)
    .in("status", ["booked", "waiting", "in_consultation"])
    .gte("slot_start", `${day}T00:00:00${TZ}`).lte("slot_start", `${day}T23:59:59${TZ}`).limit(1);
  if (dup?.length) return fail("conflict", "This patient already has a visit with this doctor today.", 409);

  const minutes = Number(settings?.opd?.avg_consult_minutes ?? settings?.opd?.slot_minutes ?? 10) || 10;
  const tokenNo = await nextCounter(db, c.hospitalId, `token:${doc.id}:${day}`);
  // Walk-ins use the exact arrival time (to the millisecond) so they never clash with booked slots.
  const start = new Date();
  const now = start.toISOString();
  const fee = Number(type === "follow_up" ? doc.followup_fee : doc.consultation_fee);
  const { data: appt, error } = await db.from("appointments").insert({
    hospital_id: c.hospitalId, patient_id: patient.id, doctor_id: doc.id, department_id: doc.department_id,
    slot_start: now, slot_end: new Date(start.getTime() + minutes * 60_000).toISOString(),
    token_no: tokenNo, type, channel: "reception", status: "waiting", checked_in_at: now, fee, created_by: c.userId,
  }).select().single();
  if (error || !appt) return fail("server", "Couldn't add the walk-in. Please try again.", 500);
  await audit(db, req, c, "walk_in", appt.id, null, appt);
  await refreshTv(db, c.hospitalId);
  return json({ ok: true, data: appt });
});
