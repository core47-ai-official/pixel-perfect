// Paste into Supabase → Edge Functions → new function "get-tv-board". Turn "Enforce JWT Verification" OFF.
// Public LCD boards (cashier counter, pharmacy pickup, operations wallboard), protected by the display token.
// Never returns patient names, MRNs or phone numbers — only token numbers, bill lines and counts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
const TZ = "+05:00";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// deno-lint-ignore no-explicit-any
type DB = any;
// deno-lint-ignore no-explicit-any
type Row = any;

/** How long a finished payment stays on the counter screen. */
const BILL_SHOW_MS = 5 * 60_000;
/** How long a dispensed prescription stays in "Ready for collection". */
const READY_SHOW_MS = 45 * 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db: DB = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const b = await req.json().catch(() => ({}));
  const token = String(b.display_token ?? "");
  const board = String(b.board ?? "");
  if (token.length < 8) return fail("unauthorized", "Display token missing.", 401);
  if (!["billing", "pharmacy", "ops"].includes(board)) return fail("invalid", "Unknown board.");

  // The hospital comes from the token itself, so a screen can never read another hospital.
  const { data: sets } = await db.from("company_settings").select("hospital_id, opd, general, branding").eq("opd->>tv_display_token", token).limit(2);
  if (!sets || sets.length !== 1) return fail("unauthorized", "This screen's display token is wrong or was changed.", 401);
  const s = sets[0];
  const hid: string = s.hospital_id;
  const { data: hosp } = await db.from("hospitals").select("name").eq("id", hid).maybeSingle();
  const head = { hospital_id: hid, hospital_name: s?.general?.hospital_name || hosp?.name || "", logo: s?.branding?.logo || null, server_time: new Date().toISOString() };
  const day = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const dayStart = `${day}T00:00:00${TZ}`, dayEnd = `${day}T23:59:59${TZ}`;

  if (board === "billing") {
    const cashierId = String(b.counter_id ?? "");
    if (!UUID.test(cashierId)) return fail("invalid", "Counter missing.");
    const { data: shift } = await db.from("cashier_shifts").select("id, cashier_name, status").eq("hospital_id", hid).eq("cashier_id", cashierId)
      .eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle();
    let bill = null;
    if (shift) {
      const { data: pay } = await db.from("payments").select("invoice_id, amount, tendered, receipt_no, created_at, kind, reverses_id")
        .eq("shift_id", shift.id).is("reverses_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (pay && Date.now() - new Date(pay.created_at).getTime() < BILL_SHOW_MS) {
        const [{ data: inv }, { data: lines }] = await Promise.all([
          db.from("invoices").select("id, invoice_no, total, discount, paid, balance, status, visit_id").eq("id", pay.invoice_id).eq("hospital_id", hid).maybeSingle(),
          db.from("invoice_lines").select("description, qty, rate, amount").eq("invoice_id", pay.invoice_id).order("created_at"),
        ]);
        if (inv) {
          let tokenNo: number | null = null;
          if (inv.visit_id) {
            const { data: v } = await db.from("visits").select("appointment_id").eq("id", inv.visit_id).maybeSingle();
            if (v?.appointment_id) tokenNo = (await db.from("appointments").select("token_no").eq("id", v.appointment_id).maybeSingle()).data?.token_no ?? null;
          }
          const amount = Number(pay.amount), tendered = pay.tendered == null ? null : Number(pay.tendered);
          bill = {
            invoice_no: inv.invoice_no, token_no: tokenNo, receipt_no: pay.receipt_no, paid_at: pay.created_at,
            lines: (lines ?? []).map((l: Row) => ({ description: l.description, qty: Number(l.qty), rate: Number(l.rate), amount: Number(l.amount) })),
            total: Number(inv.total), discount: Number(inv.discount), paid: Number(inv.paid), balance: Number(inv.balance), status: inv.status,
            amount, tendered, change: tendered != null && tendered > amount ? tendered - amount : 0,
          };
        }
      }
    }
    return json({ ok: true, data: { ...head, counter_open: !!shift, cashier_name: shift?.cashier_name ?? null, bill } });
  }

  if (board === "pharmacy") {
    const { data: rx } = await db.from("prescriptions").select("id, visit_id, status, updated_at").eq("hospital_id", hid)
      .gte("created_at", dayStart).lte("created_at", dayEnd).in("status", ["active", "partly_dispensed", "dispensed"]);
    const visitIds = [...new Set((rx ?? []).map((r: Row) => r.visit_id).filter(Boolean))];
    const { data: visits } = visitIds.length ? await db.from("visits").select("id, appointment_id, status").in("id", visitIds) : { data: [] };
    const apptIds = (visits ?? []).map((v: Row) => v.appointment_id).filter(Boolean);
    const { data: appts } = apptIds.length ? await db.from("appointments").select("id, token_no").in("id", apptIds) : { data: [] };
    const tokenOf = (visitId: string) => {
      const v = (visits ?? []).find((x: Row) => x.id === visitId);
      return (appts ?? []).find((a: Row) => a.id === v?.appointment_id)?.token_no ?? null;
    };
    const preparing: number[] = [], ready: { token_no: number; at: string }[] = [];
    for (const r of rx ?? []) {
      const tk = tokenOf(r.visit_id);
      if (tk == null) continue;
      if (r.status === "dispensed") { if (Date.now() - new Date(r.updated_at).getTime() < READY_SHOW_MS) ready.push({ token_no: tk, at: r.updated_at }); }
      else preparing.push(tk);
    }
    ready.sort((a, b) => b.at.localeCompare(a.at));
    return json({ ok: true, data: { ...head, preparing: [...new Set(preparing)].sort((a, b) => a - b), ready } });
  }

  // ops: counts only
  const [{ data: wards }, { data: beds }, { data: er }, { data: appts }, { data: orders }] = await Promise.all([
    db.from("wards").select("id, name, type").eq("hospital_id", hid).eq("is_active", true).order("name"),
    db.from("beds").select("ward_id, status").eq("hospital_id", hid),
    db.from("emergency_cases").select("triage_color").eq("hospital_id", hid).is("disposition", null),
    db.from("appointments").select("status").eq("hospital_id", hid).gte("slot_start", dayStart).lte("slot_start", dayEnd),
    db.from("orders").select("status").eq("hospital_id", hid).gte("created_at", dayStart).lte("created_at", dayEnd),
  ]);
  const count = (rows: Row[] | null, key: string) => (rows ?? []).reduce((m: Record<string, number>, r: Row) => { const k = String(r[key] ?? "none"); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const wardRows = (wards ?? []).map((w: Row) => {
    const mine = (beds ?? []).filter((x: Row) => x.ward_id === w.id);
    return { id: w.id, name: w.name, type: w.type, total: mine.length,
      occupied: mine.filter((x: Row) => x.status === "occupied").length,
      available: mine.filter((x: Row) => x.status === "free").length };
  }).filter((w: Row) => w.total > 0);
  return json({ ok: true, data: { ...head, wards: wardRows, er: count(er, "triage_color"), opd: count(appts, "status"), lab: count(orders, "status") } });
});
