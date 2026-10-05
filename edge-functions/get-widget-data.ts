// Paste into Supabase → Edge Functions → new function "get-widget-data". Turn "Enforce JWT Verification" OFF.
// Returns data for one dashboard widget. Body: { widget_id, from, to }. Roles must mirror src/config/widgets.tsx.
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
// deno-lint-ignore no-explicit-any
async function audit(db: DB, req: Request, c: any, action: string, resource: string, id: string | null, before: unknown, after: unknown) {
  await db.from("audit_logs").insert({ hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action,
    resource, resource_id: id, before, after, ip: req.headers.get("x-forwarded-for") });
}
// Widget ids + roles: must mirror src/config/widgets.tsx.
const WIDGET_ROLES: Record<string, string[]> = {
  active_users: ["super_admin", "admin"],
  errors_today: ["super_admin"],
  bed_occupancy: ["super_admin", "admin", "nurse", "dept_head", "receptionist", "er_officer"],
  opd_today: ["super_admin", "admin", "dept_head"],
  er_waiting: ["super_admin", "admin", "er_officer", "dept_head"],
  cash_vs_unpaid: ["super_admin", "admin"],
  adm_dis_trend: ["super_admin", "admin", "dept_head"],
  token_queue: ["super_admin", "admin", "receptionist"],
  appointments_today: ["super_admin", "admin", "receptionist"],
  walk_ins: ["super_admin", "admin", "receptionist"],
  no_shows: ["super_admin", "admin", "receptionist"],
  my_queue: ["doctor"],
  waiting_patients: ["doctor"],
  my_admitted: ["doctor"],
  ward_beds: ["nurse"],
  vitals_due: ["nurse"],
  shift_cash: ["cashier", "admin", "super_admin"],
  pending_bills: ["cashier", "admin", "super_admin"],
  deposits_summary: ["cashier", "admin", "super_admin"],
};
const DEFAULT_LAYOUTS: Record<string, { id: string; size: string }[]> = {
  super_admin: [{ id: "active_users", size: "small" }, { id: "errors_today", size: "small" }, { id: "bed_occupancy", size: "small" }, { id: "opd_today", size: "small" }, { id: "adm_dis_trend", size: "wide" }],
  admin: [{ id: "bed_occupancy", size: "small" }, { id: "opd_today", size: "small" }, { id: "er_waiting", size: "small" }, { id: "cash_vs_unpaid", size: "small" }, { id: "adm_dis_trend", size: "wide" }],
  receptionist: [{ id: "token_queue", size: "medium" }, { id: "appointments_today", size: "small" }, { id: "walk_ins", size: "small" }, { id: "no_shows", size: "small" }],
  doctor: [{ id: "my_queue", size: "medium" }, { id: "waiting_patients", size: "small" }, { id: "my_admitted", size: "medium" }],
  nurse: [{ id: "ward_beds", size: "medium" }, { id: "vitals_due", size: "medium" }],
  cashier: [{ id: "shift_cash", size: "small" }, { id: "pending_bills", size: "small" }, { id: "deposits_summary", size: "small" }],
  er_officer: [{ id: "er_waiting", size: "small" }, { id: "bed_occupancy", size: "small" }],
  dept_head: [{ id: "opd_today", size: "small" }, { id: "bed_occupancy", size: "small" }, { id: "adm_dis_trend", size: "wide" }],
};
const SIZES = ["small", "medium", "wide"];
const MAX_WIDGETS = 12;
// deno-lint-ignore no-explicit-any
function cleanLayout(items: any, roles: string[]) {
  if (!Array.isArray(items)) return null;
  const seen = new Set<string>();
  const out: { id: string; size: string }[] = [];
  for (const w of items) {
    const id = String(w?.id ?? ""); const size = SIZES.includes(w?.size) ? w.size : "small";
    const allowed = WIDGET_ROLES[id];
    if (!allowed || seen.has(id) || !roles.some((r) => allowed.includes(r))) continue;
    seen.add(id); out.push({ id, size });
  }
  return out.slice(0, MAX_WIDGETS);
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  const b = await req.json().catch(() => ({}));
  const id = String(b.widget_id ?? "");
  const allowed = WIDGET_ROLES[id];
  if (!allowed) return fail("not_found", "Unknown widget.", 404);
  if (!c.roles.some((r) => allowed.includes(r))) return fail("forbidden", "You can't see this widget.", 403);
  const to = b.to ? new Date(b.to) : new Date();
  const from = b.from ? new Date(b.from) : new Date(to.getTime() - 86400000);
  const span = Math.max(to.getTime() - from.getTime(), 60000);
  const prevFrom = new Date(from.getTime() - span);
  const count = async (table: string, f: Date, t: Date) => {
    const { count } = await db.from(table).select("id", { count: "exact", head: true }).eq("hospital_id", c.hospitalId)
      .gte("created_at", f.toISOString()).lt("created_at", t.toISOString());
    return count ?? 0;
  };
  if (id === "active_users") {
    const distinct = async (f: Date, t: Date) => {
      const { data } = await db.from("audit_logs").select("user_id").eq("hospital_id", c.hospitalId)
        .gte("created_at", f.toISOString()).lt("created_at", t.toISOString()).limit(5000);
      return new Set((data ?? []).map((x: { user_id: string }) => x.user_id).filter(Boolean)).size;
    };
    return json({ ok: true, data: { value: await distinct(from, to), previous: await distinct(prevFrom, from) } });
  }
  if (id === "errors_today") {
    return json({ ok: true, data: { value: await count("error_logs", from, to), previous: await count("error_logs", prevFrom, from) } });
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pkDay = (d: Date) => new Date(d.getTime() + 5 * 3600e3).toISOString().slice(0, 10);
  const todayStart = new Date(`${pkDay(new Date())}T00:00:00${TZ}`);
  const todayEnd = new Date(todayStart.getTime() + 86400e3);
  const H = c.hospitalId;
  const apptCount = async (f: Date, t: Date, extra?: (q: DB) => DB) => {
    let q = db.from("appointments").select("id", { count: "exact", head: true }).eq("hospital_id", H)
      .gte("slot_start", f.toISOString()).lt("slot_start", t.toISOString());
    q = extra ? extra(q) : q;
    const { count } = await q; return count ?? 0;
  };
  const myDoctor = async () => {
    const { data } = await db.from("doctors").select("id").eq("hospital_id", H).eq("user_id", c.userId).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };
  const nurseWardIds = async () => {
    const { data } = await db.from("user_roles").select("ward_ids").eq("user_id", c.userId).eq("hospital_id", H).eq("role", "nurse").maybeSingle();
    return (data?.ward_ids ?? []) as string[];
  };
  const mins = (s: string) => Math.max(0, Math.round((Date.now() - new Date(s).getTime()) / 60000));

  if (id === "opd_today") {
    const live = (q: DB) => q.not("status", "in", "(cancelled,needs_rebooking)");
    return json({ ok: true, data: { value: await apptCount(from, to, live), previous: await apptCount(prevFrom, from, live),
      completed: await apptCount(from, to, (q) => q.eq("status", "done")) } });
  }
  if (id === "er_waiting") {
    const { data: waiting } = await db.from("emergency_cases").select("arrived_at, triage_color").eq("hospital_id", H).is("seen_at", null).is("disposition", null).limit(500);
    const w = (waiting ?? []).map((x: { arrived_at: string }) => mins(x.arrived_at));
    const { data: seen } = await db.from("emergency_cases").select("arrived_at, seen_at").eq("hospital_id", H).not("seen_at", "is", null)
      .gte("arrived_at", from.toISOString()).lt("arrived_at", to.toISOString()).limit(2000);
    const s = (seen ?? []).map((x: { arrived_at: string; seen_at: string }) => (new Date(x.seen_at).getTime() - new Date(x.arrived_at).getTime()) / 60000);
    return json({ ok: true, data: { waiting: w.length, longest_min: w.length ? Math.max(...w) : 0,
      avg_wait_min: w.length ? Math.round(w.reduce((a: number, b: number) => a + b, 0) / w.length) : 0,
      avg_door_to_doctor_min: s.length ? Math.round(s.reduce((a: number, b: number) => a + b, 0) / s.length) : null } });
  }
  if (id === "cash_vs_unpaid") {
    const { data: pays } = await db.from("payments").select("amount, kind").eq("hospital_id", H).neq("kind", "deposit_applied")
      .gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).limit(10000);
    const { data: deps } = await db.from("deposits").select("amount").eq("hospital_id", H).gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).limit(10000);
    const { data: open } = await db.from("invoices").select("balance").eq("hospital_id", H).gt("balance", 0).in("status", ["open", "partly_paid"]).limit(10000);
    const sum = (rows: { amount?: number; balance?: number }[] | null, k: "amount" | "balance") => r2((rows ?? []).reduce((a, x) => a + Number(x[k] ?? 0), 0));
    return json({ ok: true, data: { collected: r2(sum(pays, "amount") + sum(deps, "amount")), unpaid: sum(open, "balance"), unpaid_bills: (open ?? []).length } });
  }
  if (id === "adm_dis_trend") {
    // At least the last 7 days, at most 62.
    const end = to; const start = new Date(Math.max(Math.min(from.getTime(), end.getTime() - 6 * 86400e3), end.getTime() - 61 * 86400e3));
    const days: { date: string; admissions: number; discharges: number }[] = [];
    for (let d = new Date(`${pkDay(start)}T00:00:00${TZ}`); d <= end; d = new Date(d.getTime() + 86400e3)) days.push({ date: pkDay(d), admissions: 0, discharges: 0 });
    const idx = new Map(days.map((d, i) => [d.date, i]));
    const { data: a } = await db.from("admissions").select("admitted_at").eq("hospital_id", H).gte("admitted_at", start.toISOString()).lt("admitted_at", end.toISOString()).limit(10000);
    const { data: dd } = await db.from("admissions").select("discharged_at").eq("hospital_id", H).gte("discharged_at", start.toISOString()).lt("discharged_at", end.toISOString()).limit(10000);
    for (const x of a ?? []) { const i = idx.get(pkDay(new Date(x.admitted_at))); if (i !== undefined) days[i].admissions++; }
    for (const x of dd ?? []) { const i = idx.get(pkDay(new Date(x.discharged_at))); if (i !== undefined) days[i].discharges++; }
    return json({ ok: true, data: { days } });
  }
  if (id === "token_queue") {
    const { data: rows } = await db.from("appointments").select("doctor_id, token_no, status").eq("hospital_id", H)
      .gte("slot_start", todayStart.toISOString()).lt("slot_start", todayEnd.toISOString()).in("status", ["waiting", "in_consultation"]).limit(2000);
    const docIds = [...new Set((rows ?? []).map((r: { doctor_id: string }) => r.doctor_id))];
    const names = new Map<string, string>();
    if (docIds.length) {
      const { data: docs } = await db.from("doctors").select("id, user_id").in("id", docIds);
      const { data: profs } = await db.from("profiles").select("id, full_name").in("id", (docs ?? []).map((d: { user_id: string }) => d.user_id));
      const pn = new Map((profs ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
      for (const d of docs ?? []) names.set(d.id, pn.get(d.user_id) ?? "");
    }
    const by = new Map<string, { doctor: string; waiting: number; current: number | null }>();
    for (const r of rows ?? []) {
      const e = by.get(r.doctor_id) ?? { doctor: names.get(r.doctor_id) ?? "", waiting: 0, current: null };
      if (r.status === "waiting") e.waiting++; else e.current = r.token_no;
      by.set(r.doctor_id, e);
    }
    const doctors = [...by.values()].sort((x, y) => y.waiting - x.waiting);
    return json({ ok: true, data: { waiting: doctors.reduce((a, d) => a + d.waiting, 0), in_consultation: doctors.filter((d) => d.current != null).length, doctors: doctors.slice(0, 8) } });
  }
  if (id === "appointments_today") {
    const { data: rows } = await db.from("appointments").select("status").eq("hospital_id", H)
      .gte("slot_start", from.toISOString()).lt("slot_start", to.toISOString()).not("status", "in", "(cancelled)").limit(10000);
    const by: Record<string, number> = {};
    for (const r of rows ?? []) by[r.status] = (by[r.status] ?? 0) + 1;
    return json({ ok: true, data: { total: (rows ?? []).length, by_status: by } });
  }
  if (id === "walk_ins") {
    // Walk-ins are created already checked in (checked_in_at = creation time).
    const walk = async (f: Date, t: Date) => {
      const { data } = await db.from("appointments").select("created_at, checked_in_at").eq("hospital_id", H).eq("channel", "reception")
        .not("checked_in_at", "is", null).gte("slot_start", f.toISOString()).lt("slot_start", t.toISOString()).limit(10000);
      return (data ?? []).filter((x: { created_at: string; checked_in_at: string }) => Math.abs(new Date(x.checked_in_at).getTime() - new Date(x.created_at).getTime()) < 60000).length;
    };
    return json({ ok: true, data: { value: await walk(from, to), previous: await walk(prevFrom, from) } });
  }
  if (id === "no_shows") {
    const ns = (q: DB) => q.eq("status", "no_show");
    return json({ ok: true, data: { value: await apptCount(from, to, ns), previous: await apptCount(prevFrom, from, ns) } });
  }
  if (id === "my_queue" || id === "waiting_patients") {
    const doc = await myDoctor();
    if (!doc) return json({ ok: true, data: { current: null, next: [], waiting: 0, avg_wait_min: 0, longest_min: 0 } });
    const { data: rows } = await db.from("appointments").select("token_no, status, checked_in_at, patients(full_name)").eq("hospital_id", H).eq("doctor_id", doc)
      .gte("slot_start", todayStart.toISOString()).lt("slot_start", todayEnd.toISOString()).in("status", ["waiting", "in_consultation"]).order("token_no").limit(500);
    // deno-lint-ignore no-explicit-any
    const cur = (rows ?? []).find((r: any) => r.status === "in_consultation");
    // deno-lint-ignore no-explicit-any
    const wait = (rows ?? []).filter((r: any) => r.status === "waiting");
    // deno-lint-ignore no-explicit-any
    const w = wait.map((r: any) => (r.checked_in_at ? mins(r.checked_in_at) : 0));
    return json({ ok: true, data: {
      current: cur ? { token: cur.token_no, name: cur.patients?.full_name ?? "" } : null,
      // deno-lint-ignore no-explicit-any
      next: wait.slice(0, 5).map((r: any) => ({ token: r.token_no, name: r.patients?.full_name ?? "", waited_min: r.checked_in_at ? mins(r.checked_in_at) : 0 })),
      waiting: wait.length, avg_wait_min: w.length ? Math.round(w.reduce((a: number, b: number) => a + b, 0) / w.length) : 0, longest_min: w.length ? Math.max(...w) : 0 } });
  }
  if (id === "my_admitted") {
    const doc = await myDoctor();
    if (!doc) return json({ ok: true, data: { count: 0, patients: [] } });
    const { data: rows } = await db.from("admissions").select("id, patient_id, admitted_at, patients(full_name, mrn), beds(label)").eq("hospital_id", H)
      .eq("admitting_doctor_id", doc).eq("status", "admitted").order("admitted_at").limit(200);
    // deno-lint-ignore no-explicit-any
    const patients = (rows ?? []).map((r: any) => ({ patient_id: r.patient_id, name: r.patients?.full_name ?? "", mrn: r.patients?.mrn ?? "", bed: r.beds?.label ?? "",
      days: Math.max(0, Math.floor((Date.now() - new Date(r.admitted_at).getTime()) / 86400e3)) }));
    return json({ ok: true, data: { count: patients.length, patients: patients.slice(0, 8) } });
  }
  if (id === "ward_beds" || id === "vitals_due") {
    const wardIds = await nurseWardIds();
    if (!wardIds.length) return json({ ok: true, data: { no_wards: true, total: 0, occupied: 0, free: 0, cleaning: 0, due: 0, patients: [] } });
    const { data: beds } = await db.from("beds").select("id, label, status, current_admission_id").in("ward_id", wardIds).limit(2000);
    if (id === "ward_beds") {
      const out: Record<string, number> = { total: 0, occupied: 0, free: 0, cleaning: 0, reserved: 0, out_of_service: 0 };
      for (const x of beds ?? []) { out.total++; out[x.status] = (out[x.status] ?? 0) + 1; }
      return json({ ok: true, data: { ...out, wards: wardIds.length } });
    }
    // deno-lint-ignore no-explicit-any
    const occ = (beds ?? []).filter((x: any) => x.current_admission_id);
    // deno-lint-ignore no-explicit-any
    const admIds = occ.map((x: any) => x.current_admission_id);
    const due: { name: string; bed: string; last_min: number | null }[] = [];
    if (admIds.length) {
      const { data: adm } = await db.from("admissions").select("id, patient_id, patients(full_name)").in("id", admIds);
      const pids = (adm ?? []).map((a: { patient_id: string }) => a.patient_id);
      const { data: vit } = await db.from("vitals").select("patient_id, recorded_at").in("patient_id", pids).gte("recorded_at", new Date(Date.now() - 7 * 86400e3).toISOString()).order("recorded_at", { ascending: false }).limit(5000);
      const lastBy = new Map<string, string>();
      for (const v of vit ?? []) if (!lastBy.has(v.patient_id)) lastBy.set(v.patient_id, v.recorded_at);
      // deno-lint-ignore no-explicit-any
      for (const a of (adm ?? []) as any[]) {
        const last = lastBy.get(a.patient_id); const m = last ? mins(last) : null;
        if (m === null || m >= 240) due.push({ name: a.patients?.full_name ?? "", bed: occ.find((b: { current_admission_id: string }) => b.current_admission_id === a.id)?.label ?? "", last_min: m });
      }
    }
    due.sort((x, y) => (y.last_min ?? 1e9) - (x.last_min ?? 1e9));
    return json({ ok: true, data: { due: due.length, patients: due.slice(0, 8) } });
  }
  if (id === "shift_cash") {
    const { data: shift } = await db.from("cashier_shifts").select("id, opening_cash, opened_at").eq("hospital_id", H).eq("cashier_id", c.userId).eq("status", "open").maybeSingle();
    if (!shift) return json({ ok: true, data: { open: false } });
    const { data: pays } = await db.from("payments").select("kind, amount").eq("shift_id", shift.id);
    const { data: deps } = await db.from("deposits").select("amount").eq("shift_id", shift.id);
    let taken = 0, out = 0;
    for (const p of pays ?? []) { const a = Number(p.amount); if (p.kind === "payment") taken += a; else if (p.kind === "refund" || p.kind === "reversal") out += -a; }
    for (const d of deps ?? []) taken += Number(d.amount);
    return json({ ok: true, data: { open: true, opened_at: shift.opened_at, taken: r2(taken), paid_out: r2(out), expected: r2(Number(shift.opening_cash) + taken - out) } });
  }
  if (id === "pending_bills") {
    const { data: open } = await db.from("invoices").select("balance, created_at").eq("hospital_id", H).gt("balance", 0).in("status", ["open", "partly_paid"]).limit(10000);
    const old = (open ?? []).filter((x: { created_at: string }) => Date.now() - new Date(x.created_at).getTime() > 30 * 86400e3).length;
    return json({ ok: true, data: { count: (open ?? []).length, amount: r2((open ?? []).reduce((a: number, x: { balance: number }) => a + Number(x.balance), 0)), over_30: old } });
  }
  if (id === "deposits_summary") {
    const { data: inRange } = await db.from("deposits").select("amount").eq("hospital_id", H).gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).limit(10000);
    const { data: unused } = await db.from("deposits").select("amount, applied_amount").eq("hospital_id", H).limit(10000);
    const held = r2((unused ?? []).reduce((a: number, d: { amount: number; applied_amount: number }) => a + Math.max(0, Number(d.amount) - Number(d.applied_amount)), 0));
    return json({ ok: true, data: { value: r2((inRange ?? []).reduce((a: number, d: { amount: number }) => a + Number(d.amount), 0)), count: (inRange ?? []).length, held } });
  }
  // bed_occupancy: live snapshot (date range doesn't apply). Active wards only.
  const { data: wards } = await db.from("wards").select("id").eq("hospital_id", c.hospitalId).eq("is_active", true);
  const ids = (wards ?? []).map((w: { id: string }) => w.id);
  const out = { total: 0, occupied: 0, free: 0, cleaning: 0, reserved: 0, out_of_service: 0 } as Record<string, number>;
  if (ids.length) {
    const { data: beds } = await db.from("beds").select("status").in("ward_id", ids).limit(10000);
    for (const x of beds ?? []) { out.total++; out[x.status] = (out[x.status] ?? 0) + 1; }
  }
  return json({ ok: true, data: out });
});
