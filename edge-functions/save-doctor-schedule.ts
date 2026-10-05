// Paste into Supabase → Edge Functions → new function "save-doctor-schedule". Turn "Enforce JWT Verification" OFF.
// Input: { doctor_id, slots: [{ weekday 0-6 (0=Sunday), start_time "HH:MM", end_time, slot_minutes, max_patients?, room? }] }
// Replaces the doctor's whole week. Allowed: super_admin, admin, dept_head of the doctor's department, the doctor themself.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

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
  const { data: myRoles } = await db.from("user_roles").select("role, department_id").eq("user_id", userId).eq("hospital_id", hospitalId);

  const body = await req.json().catch(() => ({}));
  const { data: doc } = await db.from("doctors").select("id, user_id, department_id")
    .eq("id", String(body.doctor_id ?? "")).eq("hospital_id", hospitalId).maybeSingle();
  if (!doc) return fail("not_found", "Doctor not found.", 404);

  const rs = myRoles ?? [];
  const allowed = rs.some((r) => r.role === "super_admin" || r.role === "admin")
    || doc.user_id === userId
    || rs.some((r) => r.role === "dept_head" && r.department_id && r.department_id === doc.department_id);
  if (!allowed) return fail("forbidden", "You can't change this doctor's schedule.", 403);

  const slots = Array.isArray(body.slots) ? body.slots : [];
  if (slots.length > 70) return fail("validation", "Too many time ranges.");
  const rows = [];
  for (const s of slots) {
    const weekday = Number(s.weekday);
    const start = String(s.start_time ?? ""), end = String(s.end_time ?? "");
    const slot = Number(s.slot_minutes);
    const max = s.max_patients == null || s.max_patients === "" ? null : Number(s.max_patients);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return fail("validation", "Invalid weekday.");
    if (!TIME.test(start) || !TIME.test(end) || end.slice(0, 5) <= start.slice(0, 5)) return fail("validation", "End time must be after start time.");
    if (!Number.isInteger(slot) || slot < 5 || slot > 240) return fail("validation", "Slot length must be 5–240 minutes.");
    if (max !== null && (!Number.isInteger(max) || max < 1 || max > 500)) return fail("validation", "Max patients must be 1–500.");
    rows.push({
      hospital_id: hospitalId, doctor_id: doc.id, weekday, start_time: start, end_time: end,
      slot_minutes: slot, max_patients: max, room: s.room ? String(s.room).trim().slice(0, 30) : null, created_by: userId,
    });
  }
  // No overlaps within a day.
  for (let d = 0; d < 7; d++) {
    const day = rows.filter((r) => r.weekday === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
    for (let i = 1; i < day.length; i++)
      if (day[i].start_time.slice(0, 5) < day[i - 1].end_time.slice(0, 5)) return fail("validation", "Time ranges on the same day overlap.");
  }

  const { data: before } = await db.from("doctor_schedules").select("*").eq("doctor_id", doc.id);
  const { error: delErr } = await db.from("doctor_schedules").delete().eq("doctor_id", doc.id);
  if (delErr) return fail("db", delErr.message);
  if (rows.length) {
    const { error } = await db.from("doctor_schedules").insert(rows);
    if (error) {
      if (before?.length) await db.from("doctor_schedules").insert(before); // restore
      return fail("db", error.message);
    }
  }

  await db.from("audit_logs").insert({
    hospital_id: hospitalId, user_id: userId, impersonated_by: impersonatedBy,
    action: "update", resource: "doctor_schedule", resource_id: doc.id,
    before: { slots: before ?? [] }, after: { slots: rows }, ip: req.headers.get("x-forwarded-for"),
  });
  return json({ ok: true, data: { count: rows.length } });
});
