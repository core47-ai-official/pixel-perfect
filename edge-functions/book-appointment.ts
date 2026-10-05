// Paste into Supabase → Edge Functions → new function "book-appointment". Turn "Enforce JWT Verification" OFF.
// Input: { patient_id, doctor_id, slot_start (ISO), type: new|follow_up|procedure, channel?: reception|phone, follow_up_of? }
// Allowed: receptionist, admin, super_admin, dept_head, doctor, er_officer.
// Double booking is blocked by the database (unique doctor + slot for active bookings): if two people book the
// same slot at the same moment, exactly one insert succeeds and the other gets "slot_taken".
// Token: per doctor per day from counters (key "token:<doctor_id>:<YYYY-MM-DD>").
// Queues a confirmation notification for the patient (if they have an app account).
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

// ---- billing helpers (MediCore) -------------------------------------------
// The Supabase web editor allows one file per function, so this block is also
// pasted at the top of every function that posts charges. Keep the copies identical.
// supabase-js has no multi-statement transactions without database functions, so
// each step is made safe to repeat instead: one open bill per patient/admission
// (unique index), one line per source (unique index), and totals are always
// recomputed from the lines, never incremented.
// deno-lint-ignore no-explicit-any
type BillingDB = any;
type ChargeInput = {
  hospitalId: string; patientId: string; admissionId?: string | null; visitId?: string | null;
  description: string; qty?: number; rate: number; sourceType: string; sourceId: string;
  tariffId?: string | null; postedBy: string | null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

async function nextInvoiceNo(db: BillingDB, hospitalId: string) {
  const year = new Date(Date.now() + 5 * 3600e3).getUTCFullYear();
  for (let i = 0; i < 8; i++) {
    const { data: k } = await db.from("counters").select("id, next_value").eq("hospital_id", hospitalId).eq("key", "invoice").maybeSingle();
    if (!k) { await db.from("counters").insert({ hospital_id: hospitalId, key: "invoice", prefix: "INV-", next_value: 1, reset_rule: "never" }); continue; }
    const { data: won } = await db.from("counters").update({ next_value: k.next_value + 1, updated_at: new Date().toISOString() })
      .eq("id", k.id).eq("next_value", k.next_value).select("id");
    if (won?.length) return `INV-${year}-${String(k.next_value).padStart(6, "0")}`;
  }
  throw new Error("Couldn't assign an invoice number.");
}

/** Finds the patient's open bill (per admission, or the OPD bill) or creates it. */
async function findOrCreateOpenInvoice(db: BillingDB, c: { hospitalId: string; patientId: string; admissionId?: string | null; visitId?: string | null; postedBy: string | null }) {
  for (let i = 0; i < 3; i++) {
    let q = db.from("invoices").select("*").eq("hospital_id", c.hospitalId).eq("patient_id", c.patientId).in("status", ["open", "partly_paid"]);
    q = c.admissionId ? q.eq("admission_id", c.admissionId) : q.is("admission_id", null);
    const { data: found } = await q.maybeSingle();
    if (found) return found;
    const invoice_no = await nextInvoiceNo(db, c.hospitalId);
    const { data, error } = await db.from("invoices").insert({
      hospital_id: c.hospitalId, patient_id: c.patientId, admission_id: c.admissionId ?? null, visit_id: c.visitId ?? null,
      invoice_no, payer_type: "self", status: "open", created_by: c.postedBy,
    }).select().single();
    if (!error) return data;
    if (error.code !== "23505") throw error; // someone else just opened it: loop and pick it up
  }
  throw new Error("Couldn't open a bill for this patient.");
}

/** Recomputes total/balance/status from the lines. Safe to call any time. */
async function recalcInvoice(db: BillingDB, invoiceId: string) {
  const { data: inv } = await db.from("invoices").select("id, discount, paid, status").eq("id", invoiceId).single();
  const { data: lines } = await db.from("invoice_lines").select("amount").eq("invoice_id", invoiceId);
  const total = r2((lines ?? []).reduce((s: number, l: { amount: number }) => s + Number(l.amount), 0));
  const discount = Number(inv.discount), paid = Number(inv.paid);
  const balance = r2(Math.max(0, total - discount - paid));
  let status = inv.status;
  if (["open", "partly_paid", "paid"].includes(status)) status = balance <= 0 && total > 0 ? "paid" : paid > 0 ? "partly_paid" : "open";
  const { data } = await db.from("invoices").update({ total, balance, status, updated_at: new Date().toISOString() }).eq("id", invoiceId).select().single();
  return data;
}

/** Adds one charge line to the right open bill and refreshes the totals. Returns null if this source was already charged. */
async function addCharge(db: BillingDB, ch: ChargeInput) {
  const qty = ch.qty ?? 1, rate = r2(Number(ch.rate) || 0);
  const inv = await findOrCreateOpenInvoice(db, { hospitalId: ch.hospitalId, patientId: ch.patientId, admissionId: ch.admissionId, visitId: ch.visitId, postedBy: ch.postedBy });
  const { data: line, error } = await db.from("invoice_lines").insert({
    hospital_id: ch.hospitalId, invoice_id: inv.id, tariff_id: ch.tariffId ?? null, description: ch.description.slice(0, 300),
    qty, rate, amount: r2(qty * rate), source_type: ch.sourceType, source_id: ch.sourceId, posted_by: ch.postedBy, created_by: ch.postedBy,
  }).select().single();
  if (error) { if (error.code === "23505") return null; throw error; }
  await recalcInvoice(db, inv.id);
  return line;
}

/** Removes a charge (e.g. cancelled appointment/test) if its bill is still open. */
async function removeCharge(db: BillingDB, hospitalId: string, sourceType: string, sourceId: string) {
  const { data: line } = await db.from("invoice_lines").select("id, invoice_id, invoices!inner(status)").eq("hospital_id", hospitalId)
    .eq("source_type", sourceType).eq("source_id", sourceId).maybeSingle();
  if (!line || !["open", "partly_paid"].includes(line.invoices.status)) return false;
  await db.from("invoice_lines").delete().eq("id", line.id);
  await recalcInvoice(db, line.invoice_id);
  return true;
}
// ---- end billing helpers ---------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => BOOKING_ROLES.includes(r))) return fail("forbidden", "You can't book appointments.", 403);

  const b = await req.json().catch(() => ({}));
  const type = ["new", "follow_up", "procedure"].includes(b.type) ? b.type : "new";
  const channel = ["reception", "phone", "portal"].includes(b.channel) ? b.channel : "reception";
  const slotStart = new Date(String(b.slot_start ?? ""));
  if (isNaN(slotStart.getTime())) return fail("validation", "Pick a slot.");

  const [{ data: patient }, { data: doc }] = await Promise.all([
    db.from("patients").select("id, user_id, full_name, mrn, print_language, merged_into").eq("id", String(b.patient_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle(),
    db.from("doctors").select("*").eq("id", String(b.doctor_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle(),
  ]);
  if (!patient) return fail("not_found", "Patient not found.", 404);
  if (patient.merged_into) return fail("validation", "This record was merged into another patient.");
  if (!doc) return fail("not_found", "Doctor not found.", 404);

  const date = localDate(slotStart.toISOString());
  const avail = await computeSlots(db, c.hospitalId, doc.id, date);
  const slot = avail.slots.find((s) => new Date(s.start).getTime() === slotStart.getTime());
  if (!slot) return fail("validation", avail.closed === "on_leave" ? "The doctor is on leave that day." : "That time isn't in the doctor's schedule.");
  if (slot.status === "booked") return fail("slot_taken", "That slot was just booked. Please pick another.", 409);
  if (slot.status === "full") return fail("full", "The doctor is fully booked for that session.", 409);
  if (slot.status === "past") return fail("validation", "That time has already passed.");

  let followUpOf: string | null = null;
  if (b.follow_up_of) {
    const { data: prev } = await db.from("appointments").select("id").eq("id", String(b.follow_up_of)).eq("patient_id", patient.id).maybeSingle();
    followUpOf = prev?.id ?? null;
  }
  const fee = Number(type === "follow_up" ? doc.followup_fee : doc.consultation_fee);

  const tokenNo = await nextCounter(db, c.hospitalId, `token:${doc.id}:${date}`);
  const { data: appt, error } = await db.from("appointments").insert({
    hospital_id: c.hospitalId, patient_id: patient.id, doctor_id: doc.id, department_id: doc.department_id,
    slot_start: slot.start, slot_end: slot.end, token_no: tokenNo, type, channel, status: "booked",
    fee, follow_up_of: followUpOf, created_by: c.userId,
  }).select().single();
  if (error) {
    if (error.code === "23505") return fail("slot_taken", "That slot was just booked by someone else. Please pick another.", 409);
    return fail("db", error.message, 500);
  }

  const [{ data: docProf }, { data: dept }] = await Promise.all([
    db.from("profiles").select("full_name").eq("id", doc.user_id).maybeSingle(),
    doc.department_id ? db.from("departments").select("name").eq("id", doc.department_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // Consultation fee goes on the patient's open OPD bill. A billing hiccup must not undo the booking.
  let billingWarning: string | null = null;
  try {
    if (fee > 0) await addCharge(db, { hospitalId: c.hospitalId, patientId: patient.id, description: `${type === "follow_up" ? "Follow-up" : "Consultation"} · ${docProf?.full_name ?? "Doctor"} · ${date}`,
      rate: fee, sourceType: "appointment", sourceId: appt.id, postedBy: c.userId });
  } catch (_e) { billingWarning = "Booked, but the fee could not be added to the bill. Please tell billing."; }
  if (patient.user_id) {
    await db.from("notifications").insert({
      hospital_id: c.hospitalId, user_id: patient.user_id, type: "appointment_booked", channel: "push",
      title: "Appointment confirmed",
      body: `${docProf?.full_name ?? "Doctor"} · ${date} ${slot.time} · Token ${tokenNo}`,
      link: "/my-appointments", created_by: c.userId,
    });
  }
  await db.from("audit_logs").insert({
    hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action: "create",
    resource: "appointment", resource_id: appt.id, after: appt, ip: req.headers.get("x-forwarded-for"),
  });
  return json({ ok: true, data: { ...appt, time: slot.time, room: slot.room, doctor_name: docProf?.full_name ?? null, department_name: dept?.name ?? null, billing_warning: billingWarning } });
});
