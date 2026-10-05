// Paste into Supabase → Edge Functions → new function "complete-ot-case". Turn "Enforce JWT Verification" OFF.
// OT coordinator / surgeon / anesthetist: complete a running case and post OT charges to the patient's bill. Charge uses tariff code OT-<TYPE> (e.g. OT-MAJOR) per started hour, else the first active tariff in category "ot". Body: { booking_id }
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


const MIN = 60_000;
const ACTIVE = ["scheduled", "in_progress"];
// deno-lint-ignore no-explicit-any
type Booking = any;
const theatreEnd = (b: Booking) => new Date(b.planned_start).getTime() + (Number(b.planned_minutes) + Number(b.cleaning_minutes)) * MIN;
const caseEnd = (b: Booking) => new Date(b.planned_start).getTime() + Number(b.planned_minutes) * MIN;
const hhmm = (ms: number) => new Date(ms + 5 * 3600e3).toISOString().slice(11, 16);
/** Returns an error message if the theatre (incl. cleaning time) or the surgeon/anesthetist is busy. */
async function findClash(db: DB, hospitalId: string, cand: { id: string; ot_id: string; planned_start: string; planned_minutes: number; cleaning_minutes: number; surgeon_id: string; anesthetist_id: string | null }, ignoreIds: string[] = []) {
  const s = new Date(cand.planned_start).getTime();
  const tEnd = theatreEnd(cand), cEnd = caseEnd(cand);
  const { data: rows } = await db.from("ot_bookings").select("id, ot_id, planned_start, planned_minutes, cleaning_minutes, surgeon_id, anesthetist_id, procedure")
    .eq("hospital_id", hospitalId).in("status", ACTIVE)
    .gte("planned_start", new Date(s - 24 * 3600e3).toISOString()).lt("planned_start", new Date(tEnd).toISOString());
  const others = (rows ?? []).filter((r: Booking) => r.id !== cand.id && !ignoreIds.includes(r.id));
  for (const r of others) {
    if (r.ot_id !== cand.ot_id) continue;
    const rs = new Date(r.planned_start).getTime();
    if (rs < tEnd && s < theatreEnd(r))
      return `This theatre is busy: "${r.procedure}" runs ${hhmm(rs)}–${hhmm(caseEnd(r))} plus ${r.cleaning_minutes} min cleaning (free from ${hhmm(theatreEnd(r))}).`;
  }
  const people = [cand.surgeon_id, cand.anesthetist_id].filter(Boolean);
  for (const r of others) {
    const rs = new Date(r.planned_start).getTime();
    if (!(rs < cEnd && s < caseEnd(r))) continue;
    if (people.includes(r.surgeon_id) || (r.anesthetist_id && people.includes(r.anesthetist_id)))
      return `The surgeon or anesthetist is already in another case ${hhmm(rs)}–${hhmm(caseEnd(r))}.`;
  }
  const day = new Date(s + 5 * 3600e3).toISOString().slice(0, 10);
  const { data: lv } = await db.from("doctor_leaves").select("id").in("doctor_id", people).eq("status", "approved").lte("from_date", day).gte("to_date", day).limit(1);
  if (lv?.length) return "The surgeon or anesthetist is on approved leave that day.";
  return null;
}
async function loadBooking(db: DB, hospitalId: string, id: unknown) {
  const { data } = await db.from("ot_bookings").select("*").eq("id", String(id ?? "")).eq("hospital_id", hospitalId).maybeSingle();
  return data as Booking;
}
async function isSurgeonOf(db: DB, userId: string, bk: Booking) {
  const { data } = await db.from("doctors").select("id").eq("user_id", userId).in("id", [bk.surgeon_id, bk.anesthetist_id].filter(Boolean));
  return !!data?.length;
}
const now = () => new Date().toISOString();
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const bk = await loadBooking(db, c.hospitalId, b.booking_id);
  if (!bk) return fail("not_found", "Booking not found.", 404);
  if (!has(c, ["super_admin", "admin", "ot_coordinator"]) && !(await isSurgeonOf(db, c.userId, bk))) return fail("forbidden", "You can't complete this case.", 403);
  if (bk.status !== "in_progress") return fail("invalid", "Only a running case can be completed.");
  const end = now();
  const { data } = await db.from("ot_bookings").update({ status: "completed", actual_end: end, updated_at: end }).eq("id", bk.id).eq("status", "in_progress").select().maybeSingle();
  if (!data) return fail("stale", "This case was just changed by someone else.", 409);
  const { data: ot } = await db.from("operation_theatres").select("name, type").eq("id", bk.ot_id).maybeSingle();
  const { data: tariffs } = await db.from("tariffs").select("id, code, name, price, category").eq("hospital_id", c.hospitalId).eq("is_active", true)
    .or(`code.ilike.OT-${ot?.type ?? "major"},category.eq.ot`);
  const tariff = (tariffs ?? []).find((t: { code: string }) => t.code.toUpperCase() === `OT-${String(ot?.type ?? "major").toUpperCase()}`) ?? (tariffs ?? [])[0];
  const mins = Math.max(1, Math.round((new Date(end).getTime() - new Date(bk.actual_start ?? bk.planned_start).getTime()) / 60000));
  const hours = Math.max(1, Math.ceil(mins / 60));
  let charge = null;
  if (tariff) {
    const { data: adm } = bk.admission_id ? { data: { id: bk.admission_id } }
      : await db.from("admissions").select("id").eq("patient_id", bk.patient_id).eq("status", "admitted").maybeSingle();
    charge = await addCharge(db, {
      hospitalId: c.hospitalId, patientId: bk.patient_id, admissionId: adm?.id ?? null,
      description: `OT charges — ${bk.procedure} (${ot?.name ?? "OT"}, ${hours} h)`, qty: hours, rate: Number(tariff.price),
      sourceType: "ot_booking", sourceId: bk.id, tariffId: tariff.id, postedBy: c.userId,
    });
  }
  await audit(db, req, c, "complete", "ot_booking", bk.id, bk, data);
  return json({ ok: true, data: { ...data, charge, charge_missing: !tariff } });
});
