// Paste into Supabase → Edge Functions → new function "post-daily-room-charges". Turn "Enforce JWT Verification" OFF.
// Scheduled daily at 00:05 Pakistan time (19:05 UTC) by Supabase Cron. Called with header x-cron-key = CRON_SECRET (set in Edge Function secrets).
// Charges every active admission one day of its current bed's daily rate for the day that just ended.
// Safe to re-run: each admission/day is charged at most once. Body (optional): { date: "YYYY-MM-DD" } to post a missed day.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
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
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-key") !== secret) return json({ ok: false, error: { code: "forbidden", message: "Not allowed." } }, 403);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const b = await req.json().catch(() => ({}));
  // Yesterday in Pakistan time (UTC+5).
  const pk = new Date(Date.now() + 5 * 3600e3);
  pk.setUTCDate(pk.getUTCDate() - 1);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date ?? "")) ? String(b.date) : pk.toISOString().slice(0, 10);
  const dayEnd = new Date(`${day}T23:59:59+05:00`).toISOString();
  const { data: adms, error } = await db.from("admissions").select("id, hospital_id, patient_id, bed_id, admitted_at, beds(label, bed_class, daily_rate, wards(name))")
    .eq("status", "admitted").lte("admitted_at", dayEnd).limit(5000);
  if (error) return json({ ok: false, error: { code: "server", message: error.message } }, 500);
  let posted = 0, skipped = 0, failed = 0;
  for (const a of adms ?? []) {
    // deno-lint-ignore no-explicit-any
    const bed: any = a.beds;
    if (!bed || !(Number(bed.daily_rate) > 0)) { skipped++; continue; }
    try {
      const line = await addCharge(db, { hospitalId: a.hospital_id, patientId: a.patient_id, admissionId: a.id,
        description: `Room · ${bed.wards?.name ?? "Ward"} ${bed.label} · ${day}`, rate: Number(bed.daily_rate),
        sourceType: "room_day", sourceId: `${a.id}:${day}`, postedBy: null });
      if (line) posted++; else skipped++;
    } catch (e) {
      failed++;
      await db.from("error_logs").insert({ hospital_id: a.hospital_id, function_name: "post-daily-room-charges", message: `Admission ${a.id} ${day}: ${(e as Error).message}` });
    }
  }
  return json({ ok: true, data: { day, posted, skipped, failed } });
});
