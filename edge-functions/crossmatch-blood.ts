// Paste into Supabase → Edge Functions → new function "crossmatch-blood". Turn "Enforce JWT Verification" OFF.
// Blood bank: record the crossmatch for a request. Body: { request_id, result: compatible|incompatible, unit_ids?: uuid[] (reserved when compatible), note? }
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

// ---- blood bank helpers (copied into every blood function) ----------------
const GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const COMPONENTS = ["whole", "prbc", "ffp", "platelets"];
const COMPONENT_LABEL: Record<string, string> = { whole: "Whole blood", prbc: "Packed red cells", ffp: "Fresh frozen plasma", platelets: "Platelets" };
const BANK_ROLES = ["super_admin", "admin", "lab_tech"];
const REQUEST_ROLES = ["super_admin", "admin", "doctor", "er_officer"];
/** Can a unit of donor group go to the recipient for this component? Red cells/whole: ABO+Rh donor rules; plasma: reverse ABO; platelets: any ABO, Rh- recipients only get Rh-. */
function compatible(component: string, donor: string, recipient: string) {
  const dAbo = donor.replace(/[+-]/, ""), rAbo = recipient.replace(/[+-]/, "");
  const dNeg = donor.endsWith("-"), rNeg = recipient.endsWith("-");
  if (component === "ffp") {
    const plasma: Record<string, string[]> = { O: ["O", "A", "B", "AB"], A: ["A", "AB"], B: ["B", "AB"], AB: ["AB"] };
    return (plasma[rAbo] ?? []).includes(dAbo);
  }
  if (component === "platelets") return !(rNeg && !dNeg);
  const red: Record<string, string[]> = { O: ["O"], A: ["A", "O"], B: ["B", "O"], AB: ["AB", "A", "B", "O"] };
  return (red[rAbo] ?? []).includes(dAbo) && !(rNeg && !dNeg);
}
// ---- end blood bank helpers -------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, BANK_ROLES)) return fail("forbidden", "Only the blood bank can crossmatch.", 403);
  const { data: r } = await db.from("blood_requests").select("*").eq("id", String(b.request_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!r) return fail("not_found", "Request not found.", 404);
  if (!["requested", "crossmatched", "incompatible"].includes(r.status)) return fail("conflict", "This request can no longer be crossmatched.", 409);
  const result = b.result === "incompatible" ? "incompatible" : b.result === "compatible" ? "compatible" : null;
  if (!result) return fail("validation", "Pick the crossmatch result.");
  const note = b.note ? String(b.note).slice(0, 500) : null;
  if (result === "incompatible" && !note) return fail("validation", "Add a note for an incompatible crossmatch.");
  // Release any units reserved earlier for this request.
  if (r.reserved_unit_ids?.length) await db.from("blood_units").update({ status: "available", reserved_for_request_id: null, updated_at: new Date().toISOString() })
    .in("id", r.reserved_unit_ids).eq("status", "reserved").eq("reserved_for_request_id", r.id);
  const reserved: string[] = [];
  if (result === "compatible") {
    const ids = Array.isArray(b.unit_ids) ? [...new Set(b.unit_ids.map(String))].slice(0, r.units) : [];
    if (!ids.length) return fail("validation", "Pick the units that matched.");
    const { data: units } = await db.from("blood_units").select("*").in("id", ids).eq("hospital_id", c.hospitalId);
    for (const u of units ?? []) {
      if (u.component !== r.component) return fail("validation", `Unit ${u.unit_no} is a different component.`);
      if (!compatible(r.component, u.blood_group, r.blood_group)) return fail("validation", `Unit ${u.unit_no} (${u.blood_group}) can't be given to ${r.blood_group}.`);
      if (new Date(u.expires_at).getTime() <= Date.now()) return fail("validation", `Unit ${u.unit_no} has expired.`);
    }
    for (const id of ids) {
      const { data: won } = await db.from("blood_units").update({ status: "reserved", reserved_for_request_id: r.id, updated_at: new Date().toISOString() })
        .eq("id", id).eq("status", "available").select("id");
      if (won?.length) reserved.push(id);
    }
    if (reserved.length < ids.length) {
      if (reserved.length) await db.from("blood_units").update({ status: "available", reserved_for_request_id: null }).in("id", reserved);
      return fail("conflict", "A unit was just taken. Refresh and pick again.", 409);
    }
  }
  const { data: after, error } = await db.from("blood_requests").update({
    crossmatch_result: result, crossmatch_note: note, crossmatched_by: c.userId, crossmatched_at: new Date().toISOString(),
    reserved_unit_ids: reserved, status: result === "compatible" ? "crossmatched" : "incompatible", updated_at: new Date().toISOString(),
  }).eq("id", r.id).eq("status", r.status).select().single();
  if (error || !after) {
    if (reserved.length) await db.from("blood_units").update({ status: "available", reserved_for_request_id: null }).in("id", reserved);
    return fail("conflict", "The request changed meanwhile. Refresh and try again.", 409);
  }
  await audit(db, req, c, "crossmatch", "blood_request", r.id, r, after);
  return json({ ok: true, data: after });
});
