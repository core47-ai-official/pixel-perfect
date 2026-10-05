// Paste into Supabase → Edge Functions → new function "dispense-prescription". Turn "Enforce JWT Verification" OFF.
// Pharmacist / admin. Body: { prescription_id, preview?: true, items?: [{ item_id, qty, substitute_medicine_id?, substitution_reason? }] }
// preview → items with remaining qty, FEFO batch plan, stock and warnings. Otherwise dispenses: first-expiry-first-out, never expired,
// compare-and-set on qty_on_hand (rolled back on conflict, since there are no DB transactions), pharmacy charges via billing helpers.
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

const RX_ROLES = ["super_admin", "admin", "pharmacist"];
const now = () => new Date().toISOString();
const todayPk = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const daysUntil = (ymd: string) => Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${todayPk()}T00:00:00Z`)) / 86400e3);
// deno-lint-ignore no-explicit-any
type Med = any;
const medName = (m: Med) => [m.brand_name || m.generic_name, m.strength].filter(Boolean).join(" ");
const sameGeneric = (a: Med, b: Med) => String(a.generic_name).trim().toLowerCase() === String(b.generic_name).trim().toLowerCase();

/** Usable batches for a medicine, earliest expiry first; expired batches are never used. */
async function usableBatches(db: DB, hospitalId: string, medicineId: string) {
  const { data } = await db.from("stock_batches").select("id, batch_no, expiry_date, qty_on_hand, received_at")
    .eq("hospital_id", hospitalId).eq("medicine_id", medicineId).gt("qty_on_hand", 0).gte("expiry_date", todayPk())
    .order("expiry_date", { ascending: true }).order("received_at", { ascending: true });
  return (data ?? []) as { id: string; batch_no: string; expiry_date: string; qty_on_hand: number }[];
}
function plan(batches: { id: string; batch_no: string; expiry_date: string; qty_on_hand: number }[], qty: number) {
  const picks: { batch_id: string; batch_no: string; expiry_date: string; qty: number; on_hand: number }[] = [];
  let left = qty;
  for (const b of batches) {
    if (left <= 0) break;
    const take = Math.min(left, b.qty_on_hand);
    picks.push({ batch_id: b.id, batch_no: b.batch_no, expiry_date: b.expiry_date, qty: take, on_hand: b.qty_on_hand });
    left -= take;
  }
  return { picks, short: left };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, RX_ROLES)) return fail("forbidden", "Only a pharmacist or admin can dispense.", 403);

  const { data: rx } = await db.from("prescriptions").select("*").eq("id", String(b.prescription_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!rx) return fail("not_found", "Prescription not found.", 404);
  const { data: items } = await db.from("prescription_items").select("*").eq("prescription_id", rx.id).order("sort_order");
  const { data: done } = await db.from("dispensations").select("item_id, qty").eq("prescription_id", rx.id);
  const given = new Map<string, number>();
  for (const d of done ?? []) given.set(d.item_id, (given.get(d.item_id) ?? 0) + d.qty);
  const medIds = [...new Set((items ?? []).map((i: Med) => i.medicine_id))];
  const { data: meds } = await db.from("medicines").select("*").eq("hospital_id", c.hospitalId).in("id", medIds.length ? medIds : ["00000000-0000-0000-0000-000000000000"]);
  const medMap = new Map((meds ?? []).map((m: Med) => [m.id, m]));

  if (b.preview) {
    const out = [];
    for (const it of items ?? []) {
      const remaining = Math.max(0, Number(it.quantity) - (given.get(it.id) ?? 0));
      const med = medMap.get(it.medicine_id);
      const batches = await usableBatches(db, c.hospitalId, it.medicine_id);
      const stock = batches.reduce((s, x) => s + x.qty_on_hand, 0);
      const p = plan(batches, remaining);
      const warnings: string[] = [];
      if (remaining > 0 && p.short > 0) warnings.push(stock === 0 ? "no_stock" : "short_stock");
      if (p.picks.some((x) => daysUntil(x.expiry_date) <= 30)) warnings.push("expiring_soon");
      if (med && !med.is_active) warnings.push("inactive");
      // Generic alternatives with stock (same generic name, different product).
      const { data: alts } = med ? await db.from("medicines").select("id, generic_name, brand_name, strength, form, unit_price").eq("hospital_id", c.hospitalId)
        .ilike("generic_name", med.generic_name).neq("id", med.id).eq("is_active", true) : { data: [] };
      const alternatives = [];
      for (const a of alts ?? []) {
        const ab = await usableBatches(db, c.hospitalId, a.id);
        alternatives.push({ ...a, name: medName(a), stock: ab.reduce((s, x) => s + x.qty_on_hand, 0) });
      }
      out.push({ item_id: it.id, medicine_id: it.medicine_id, medicine_name: it.medicine_name, dose: it.dose, frequency: it.frequency,
        route: it.route, duration_days: it.duration_days, instructions_en: it.instructions_en, instructions_ur: it.instructions_ur,
        quantity: it.quantity, dispensed: given.get(it.id) ?? 0, remaining, unit_price: Number(med?.unit_price ?? 0), stock,
        suggested: p.picks, warnings, alternatives });
    }
    return json({ ok: true, data: { prescription: rx, items: out } });
  }

  if (!["active", "partly_dispensed"].includes(rx.status)) return fail("locked", "This prescription is already fully dispensed or closed.", 409);
  const req_items = Array.isArray(b.items) ? b.items : [];
  if (!req_items.length) return fail("invalid", "Choose at least one medicine to dispense.");
  const itemMap = new Map((items ?? []).map((i: Med) => [i.id, i]));

  // Validate everything and plan batches before writing anything.
  const work = [];
  for (const r of req_items) {
    const it = itemMap.get(String(r.item_id ?? ""));
    if (!it) return fail("invalid", "A medicine is not on this prescription.");
    const qty = Math.round(Number(r.qty));
    if (!(qty > 0)) continue;
    const remaining = Number(it.quantity) - (given.get(it.id) ?? 0);
    if (qty > remaining) return fail("invalid", `${it.medicine_name}: only ${Math.max(0, remaining)} left to dispense.`);
    let med = medMap.get(it.medicine_id);
    let subId: string | null = null, subReason: string | null = null;
    if (r.substitute_medicine_id && r.substitute_medicine_id !== it.medicine_id) {
      const { data: sub } = await db.from("medicines").select("*").eq("id", String(r.substitute_medicine_id)).eq("hospital_id", c.hospitalId).maybeSingle();
      if (!sub || !sub.is_active) return fail("invalid", "Substitute medicine not found.");
      if (!med || !sameGeneric(med, sub)) return fail("invalid", `Only a generic equivalent of ${it.medicine_name} can be substituted.`);
      subReason = String(r.substitution_reason ?? "").trim().slice(0, 300);
      if (subReason.length < 3) return fail("invalid", `Give a reason for substituting ${it.medicine_name}.`);
      subId = sub.id; med = sub;
    }
    const p = plan(await usableBatches(db, c.hospitalId, med.id), qty);
    if (p.short > 0) return fail("short_stock", `Not enough unexpired stock of ${medName(med)} (short by ${p.short}).`, 409);
    work.push({ it, med, qty, picks: p.picks, subId, subReason });
  }
  if (!work.length) return fail("invalid", "Enter a quantity to dispense.");

  // Reduce stock with compare-and-set; undo on any conflict.
  const applied: { batch_id: string; from: number; to: number }[] = [];
  const undo = async () => { for (const a of applied.reverse()) await db.from("stock_batches").update({ qty_on_hand: a.from, updated_at: now() }).eq("id", a.batch_id).eq("qty_on_hand", a.to); };
  for (const w of work) for (const p of w.picks) {
    const to = p.on_hand - p.qty;
    const { data: ok } = await db.from("stock_batches").update({ qty_on_hand: to, updated_at: now() }).eq("id", p.batch_id).eq("qty_on_hand", p.on_hand).select("id").maybeSingle();
    if (!ok) { await undo(); return fail("stale", "Stock just changed. Reload and try again.", 409); }
    applied.push({ batch_id: p.batch_id, from: p.on_hand, to });
  }

  const { data: adm } = await db.from("admissions").select("id").eq("hospital_id", c.hospitalId).eq("patient_id", rx.patient_id).eq("status", "admitted").maybeSingle();
  const lines = [];
  for (const w of work) for (const p of w.picks) {
    const rate = Number(w.med.unit_price ?? 0);
    const { data: d, error } = await db.from("dispensations").insert({ hospital_id: c.hospitalId, prescription_id: rx.id, item_id: w.it.id,
      batch_id: p.batch_id, medicine_id: w.med.id, qty: p.qty, unit_price: rate, dispensed_by: c.userId,
      substituted_medicine_id: w.subId, substitution_reason: w.subReason }).select().single();
    if (error) { await undo(); return fail("server", "Could not save the dispensing. Nothing was taken from stock.", 500); }
    const charge = await addCharge(db, { hospitalId: c.hospitalId, patientId: rx.patient_id, admissionId: adm?.id ?? null, visitId: adm ? null : rx.visit_id,
      description: `Pharmacy — ${medName(w.med)} (batch ${p.batch_no})`, qty: p.qty, rate, sourceType: "dispensation", sourceId: d.id, postedBy: c.userId });
    lines.push({ ...d, medicine_name: medName(w.med), batch_no: p.batch_no, expiry_date: p.expiry_date, charge_amount: charge?.amount ?? 0 });
  }

  for (const w of work) given.set(w.it.id, (given.get(w.it.id) ?? 0) + w.qty);
  const allDone = (items ?? []).every((i: Med) => (given.get(i.id) ?? 0) >= Number(i.quantity));
  const status = allDone ? "dispensed" : "partly_dispensed";
  await db.from("prescriptions").update({ status, updated_at: now() }).eq("id", rx.id);
  await audit(db, req, c, "dispense", "prescription", rx.id, { status: rx.status }, { status, lines });
  return json({ ok: true, data: { status, lines } });
});
