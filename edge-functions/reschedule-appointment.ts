// Paste into Supabase → Edge Functions → new function "reschedule-appointment". Turn "Enforce JWT Verification" OFF.
// Input: { appointment_id, slot_start (ISO), doctor_id? (defaults to the same doctor), reason? }
// Moves a booked / waiting / needs_rebooking appointment to a new free slot; a new token is issued for the new day.
// The database's unique doctor+slot rule still blocks double booking.
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

interface Slot { start: string; end: string; time: string; status: "free" | "booked" | "full" | "past"; room: string | null }

/** Slots for one doctor on one date: schedule minus leave, holidays and booked slots. */
async function computeSlots(db: DB, hospitalId: string, doctorId: string, date: string) {
  const weekday = new Date(`${date}T12:00:00${TZ}`).getUTCDay(); // 0 = Sunday
  const [{ data: sched }, { data: leaves }, { data: hols }, { data: booked }] = await Promise.all([
    db.from("doctor_schedules").select("*").eq("hospital_id", hospitalId).eq("doctor_id", doctorId).eq("weekday", weekday).order("start_time"),
    db.from("doctor_leaves").select("id").eq("hospital_id", hospitalId).eq("doctor_id", doctorId).eq("status", "approved")
      .lte("from_date", date).gte("to_date", date).limit(1),
    db.from("holidays").select("name, holiday_date, is_recurring").eq("hospital_id", hospitalId),
    db.from("appointments").select("slot_start").eq("hospital_id", hospitalId).eq("doctor_id", doctorId)
      .gte("slot_start", `${date}T00:00:00${TZ}`).lte("slot_start", `${date}T23:59:59${TZ}`)
      .not("status", "in", "(cancelled,no_show)"),
  ]);
  if (leaves?.length) return { closed: "on_leave" as const, slots: [] as Slot[] };
  const hol = (hols ?? []).find((h) => h.holiday_date === date || (h.is_recurring && h.holiday_date.slice(5) === date.slice(5)));
  if (hol) return { closed: "holiday" as const, holiday: hol.name, slots: [] as Slot[] };

  const takenMs = new Set((booked ?? []).map((b) => new Date(b.slot_start).getTime()));
  const now = Date.now();
  const slots: Slot[] = [];
  for (const s of sched ?? []) {
    const startMs = new Date(`${date}T${s.start_time.slice(0, 5)}:00${TZ}`).getTime();
    const endMs = new Date(`${date}T${s.end_time.slice(0, 5)}:00${TZ}`).getTime();
    const step = s.slot_minutes * 60_000;
    const block: Slot[] = [];
    for (let t = startMs; t + step <= endMs; t += step) {
      const local = new Date(t + 5 * 3600_000).toISOString().slice(11, 16);
      block.push({
        start: new Date(t).toISOString(), end: new Date(t + step).toISOString(), time: local, room: s.room ?? null,
        status: takenMs.has(t) ? "booked" : t < now ? "past" : "free",
      });
    }
    const used = block.filter((x) => x.status === "booked").length;
    if (s.max_patients && used >= s.max_patients) block.forEach((x) => { if (x.status === "free") x.status = "full"; });
    slots.push(...block);
  }
  return { closed: (sched?.length ? null : "no_schedule") as null | "no_schedule", slots };
}

/** Next number from a counter row, compare-and-swap so two bookings never share a token. */
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => BOOKING_ROLES.includes(r))) return fail("forbidden", "You can't reschedule appointments.", 403);
  const b = await req.json().catch(() => ({}));

  const { data: before } = await db.from("appointments").select("*").eq("id", String(b.appointment_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!before) return fail("not_found", "Appointment not found.", 404);
  if (!["booked", "waiting", "needs_rebooking"].includes(before.status)) return fail("conflict", "This appointment can't be rescheduled.", 409);

  const doctorId = b.doctor_id ? String(b.doctor_id) : before.doctor_id;
  const { data: doc } = await db.from("doctors").select("*").eq("id", doctorId).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!doc) return fail("not_found", "Doctor not found.", 404);
  const slotStart = new Date(String(b.slot_start ?? ""));
  if (isNaN(slotStart.getTime())) return fail("validation", "Pick a slot.");

  const date = localDate(slotStart.toISOString());
  const avail = await computeSlots(db, c.hospitalId, doc.id, date);
  const slot = avail.slots.find((s) => new Date(s.start).getTime() === slotStart.getTime());
  if (!slot || slot.status !== "free") return fail("slot_taken", "That slot isn't available. Please pick another.", 409);

  const tokenNo = await nextCounter(db, c.hospitalId, `token:${doc.id}:${date}`);
  const fee = doctorId === before.doctor_id ? before.fee : Number(before.type === "follow_up" ? doc.followup_fee : doc.consultation_fee);
  const { data: after, error } = await db.from("appointments").update({
    doctor_id: doc.id, department_id: doc.department_id, slot_start: slot.start, slot_end: slot.end,
    token_no: tokenNo, fee, status: "booked", updated_at: new Date().toISOString(),
  }).eq("id", before.id).eq("status", before.status).select().single();
  if (error) {
    if (error.code === "23505") return fail("slot_taken", "That slot was just booked by someone else.", 409);
    return fail("db", error.message, 500);
  }
  if (!after) return fail("conflict", "The appointment changed meanwhile. Refresh and try again.", 409);

  const { data: p } = await db.from("patients").select("user_id").eq("id", before.patient_id).maybeSingle();
  if (p?.user_id) await db.from("notifications").insert({
    hospital_id: c.hospitalId, user_id: p.user_id, type: "appointment_rescheduled", channel: "push",
    title: "Appointment rescheduled", body: `${date} ${slot.time} · Token ${tokenNo}`, link: "/my-appointments", created_by: c.userId,
  });
  await db.from("audit_logs").insert({
    hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action: "reschedule",
    resource: "appointment", resource_id: before.id, before, after: { ...after, reason: b.reason ?? null }, ip: req.headers.get("x-forwarded-for"),
  });
  return json({ ok: true, data: { ...after, time: slot.time, room: slot.room } });
});
