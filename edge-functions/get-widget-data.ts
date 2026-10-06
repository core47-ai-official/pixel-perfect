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
const has = (c: { roles: string[] }, list: string[]) => c.roles.some((r) => list.includes(r));
// ---- department scope (MediCore; identical in every department function) ----
const ADMIN_ROLES = ["super_admin", "admin"];
/** dept_head → own department (from their dept_head role row); admin → the department they ask for. */
async function deptScope(db: DB, c: { userId: string; hospitalId: string; roles: string[] }, wanted: unknown) {
  const isAdmin = has(c, ADMIN_ROLES);
  let deptId: string | null = null;
  if (isAdmin && wanted && wanted !== "mine") deptId = String(wanted);
  else if (c.roles.includes("dept_head")) {
    const { data } = await db.from("user_roles").select("department_id").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).eq("role", "dept_head").maybeSingle();
    deptId = (data?.department_id as string | undefined) ?? null;
  } else if (isAdmin) return { error: fail("bad_request", "Choose a department.") };
  else return { error: fail("forbidden", "Only department heads and admins can see this.", 403) };
  if (!deptId) return { error: fail("no_department", "You are not assigned to a department yet.") };
  const { data: dept } = await db.from("departments").select("id, name").eq("hospital_id", c.hospitalId).eq("id", deptId).maybeSingle();
  if (!dept) return { error: fail("not_found", "Department not found.", 404) };
  const { data: docs } = await db.from("doctors").select("id, user_id, specialty, status").eq("hospital_id", c.hospitalId).eq("department_id", deptId);
  const uids = (docs ?? []).map((d: { user_id: string }) => d.user_id);
  const { data: profs } = uids.length ? await db.from("profiles").select("id, full_name").in("id", uids) : { data: [] };
  const pn = new Map((profs ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
  // deno-lint-ignore no-explicit-any
  const doctors = (docs ?? []).map((d: any) => ({ id: d.id as string, user_id: d.user_id as string, name: (pn.get(d.user_id) ?? "") as string, specialty: d.specialty as string, status: d.status as string }));
  return { dept: dept as { id: string; name: string }, doctors };
}
// ---- end department scope ---------------------------------------------------
// Widget ids + roles: must mirror src/config/widgets.tsx.
const WIDGET_ROLES: Record<string, string[]> = {
  active_users: ["super_admin", "admin"],
  errors_today: ["super_admin"],
  bed_occupancy: ["super_admin", "admin", "nurse", "dept_head", "receptionist", "er_officer"],
  opd_today: ["super_admin", "admin", "dept_head"],
  er_waiting: ["super_admin", "admin", "er_officer", "dept_head"],
  cash_vs_unpaid: ["super_admin", "admin"],
  surge_watch: ["super_admin", "admin"],
  adm_dis_trend: ["super_admin", "admin", "dept_head"],
  token_queue: ["super_admin", "admin", "receptionist"],
  appointments_today: ["super_admin", "admin", "receptionist"],
  walk_ins: ["super_admin", "admin", "receptionist"],
  no_shows: ["super_admin", "admin", "receptionist"],
  my_queue: ["doctor"],
  waiting_patients: ["doctor"],
  my_admitted: ["doctor"],
  critical_results: ["doctor"],
  ward_beds: ["nurse"],
  vitals_due: ["nurse"],
  shift_cash: ["cashier", "admin", "super_admin"],
  pending_bills: ["cashier", "admin", "super_admin"],
  deposits_summary: ["cashier", "admin", "super_admin"],
  dept_opd_by_doctor: ["dept_head"],
  dept_waiting_now: ["dept_head"],
  dept_admissions: ["dept_head"],
  dept_top_diagnoses: ["dept_head"],
  dept_revenue: ["dept_head"],
  dept_on_leave: ["dept_head"],
  my_duty: ["super_admin", "admin", "dept_head", "doctor", "nurse", "er_officer", "ot_coordinator", "receptionist", "pharmacist", "lab_tech", "cashier"],
};
const DEFAULT_LAYOUTS: Record<string, { id: string; size: string }[]> = {
  super_admin: [{ id: "active_users", size: "small" }, { id: "errors_today", size: "small" }, { id: "bed_occupancy", size: "small" }, { id: "opd_today", size: "small" }, { id: "adm_dis_trend", size: "wide" }],
  admin: [{ id: "bed_occupancy", size: "small" }, { id: "opd_today", size: "small" }, { id: "er_waiting", size: "small" }, { id: "cash_vs_unpaid", size: "small" }, { id: "adm_dis_trend", size: "wide" }],
  receptionist: [{ id: "token_queue", size: "medium" }, { id: "appointments_today", size: "small" }, { id: "walk_ins", size: "small" }, { id: "no_shows", size: "small" }],
  doctor: [{ id: "my_queue", size: "medium" }, { id: "waiting_patients", size: "small" }, { id: "my_admitted", size: "medium" }, { id: "critical_results", size: "medium" }],
  nurse: [{ id: "ward_beds", size: "medium" }, { id: "vitals_due", size: "medium" }],
  cashier: [{ id: "shift_cash", size: "small" }, { id: "pending_bills", size: "small" }, { id: "deposits_summary", size: "small" }],
  er_officer: [{ id: "er_waiting", size: "small" }, { id: "bed_occupancy", size: "small" }],
  dept_head: [{ id: "dept_opd_by_doctor", size: "medium" }, { id: "dept_waiting_now", size: "small" }, { id: "dept_revenue", size: "small" }, { id: "dept_admissions", size: "small" }, { id: "dept_on_leave", size: "medium" }, { id: "dept_top_diagnoses", size: "medium" }],
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
// Surveillance groups by ICD-10 code prefix (mirrored in src/lib/surveillance.ts).
const SURV_GROUPS: Record<string, string[]> = {
  dengue: ["A90", "A91", "A97"], malaria: ["B50", "B51", "B52", "B53", "B54"], typhoid: ["A01"],
  hepatitis: ["B15", "B16", "B17", "B18", "B19"], tb: ["A15", "A16", "A17", "A18", "A19"], measles: ["B05"], heatstroke: ["T67"],
};
const AGE_GROUPS = ["0-4", "5-14", "15-24", "25-44", "45-64", "65+", "unknown"];
const survGroup = (code: string) => { const c = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); for (const [g, ps] of Object.entries(SURV_GROUPS)) if (ps.some((p) => c.startsWith(p))) return g; return null; };
const survDay = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600e3).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
function ageGroup(dob: string | null, at: string) {
  if (!dob) return "unknown";
  const a = (Date.parse(at) - Date.parse(dob)) / (365.25 * 864e5);
  return a < 5 ? "0-4" : a < 15 ? "5-14" : a < 25 ? "15-24" : a < 45 ? "25-44" : a < 65 ? "45-64" : "65+";
}
// One case = one patient + disease per visit (several codes of one disease on a visit count once).
// Surge: a 7-day week (ending on `to`, stepping back) is ≥50% above the average of the 4 weeks before it (and ≥3 cases).
// deno-lint-ignore no-explicit-any
async function surveillance(db: any, hospitalId: string, from: string, to: string, groups: string[]) {
  const start = addDays(from, -28); // extra 4 weeks for the baseline
  const prefixes = groups.flatMap((g) => SURV_GROUPS[g] ?? []);
  const or = prefixes.map((p) => `icd10_code.ilike.${p}%`).join(",");
  const rows: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from("visit_diagnoses").select("icd10_code, created_at, visit_id, visits!inner(patient_id, created_at, patients(district, dob))")
      .eq("hospital_id", hospitalId).or(or).gte("created_at", `${start}T00:00:00+05:00`).lte("created_at", `${to}T23:59:59.999+05:00`).range(off, off + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const seen = new Set<string>();
  const cases: { g: string; day: string; district: string; age: string }[] = [];
  for (const r of rows) {
    const g = survGroup(r.icd10_code); if (!g || !groups.includes(g)) continue;
    const k = `${r.visit_id}|${g}`; if (seen.has(k)) continue; seen.add(k);
    const at = r.visits?.created_at ?? r.created_at;
    cases.push({ g, day: survDay(at), district: (r.visits?.patients?.district ?? "").trim() || "Unknown", age: ageGroup(r.visits?.patients?.dob ?? null, at) });
  }
  const days: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const inRange = cases.filter((x) => x.day >= from && x.day <= to);
  const daily = days.map((d) => { const o: Record<string, unknown> = { day: d }; for (const g of groups) o[g] = 0; return o; });
  const di = new Map(days.map((d, i) => [d, i]));
  const districts: Record<string, Record<string, number>> = {};
  const ages: Record<string, Record<string, number>> = {};
  const totals: Record<string, number> = {};
  for (const x of inRange) {
    (daily[di.get(x.day)!] as any)[x.g]++;
    (districts[x.district] ??= {})[x.g] = (districts[x.district][x.g] ?? 0) + 1;
    (ages[x.age] ??= {})[x.g] = (ages[x.age][x.g] ?? 0) + 1;
    totals[x.g] = (totals[x.g] ?? 0) + 1;
  }
  const count = (g: string, a: string, b: string) => cases.filter((x) => x.g === g && x.day >= a && x.day <= b).length;
  const weeks: Record<string, { end: string; count: number; baseline: number; surge: boolean }[]> = {};
  const surges: { group: string; week_end: string; count: number; baseline: number; pct: number }[] = [];
  for (const g of groups) {
    weeks[g] = [];
    for (let end = to; end >= addDays(from, 6); end = addDays(end, -7)) {
      const n = count(g, addDays(end, -6), end);
      let base = 0; for (let w = 1; w <= 4; w++) base += count(g, addDays(end, -6 - 7 * w), addDays(end, -7 * w));
      base = Math.round((base / 4) * 10) / 10;
      const surge = n >= 3 && n >= base * 1.5 && n > base;
      weeks[g].unshift({ end, count: n, baseline: base, surge });
      if (surge) surges.push({ group: g, week_end: end, count: n, baseline: base, pct: base > 0 ? Math.round(((n - base) / base) * 100) : 100 });
    }
  }
  return {
    from, to, groups, daily, totals, weeks, surges,
    districts: Object.entries(districts).map(([district, v]) => ({ district, ...v, total: Object.values(v).reduce((s, n) => s + n, 0) })).sort((a, b) => b.total - a.total),
    ages: AGE_GROUPS.filter((a) => ages[a]).map((age) => ({ age, ...ages[age], total: Object.values(ages[age]).reduce((s, n) => s + n, 0) })),
  };
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

  if (id === "surge_watch") {
    // Last 7 days vs the 4 weeks before, all groups; date filter doesn't apply.
    const to = survDay(new Date().toISOString());
    const r = await surveillance(db, H, addDays(to, -6), to, Object.keys(SURV_GROUPS));
    const items = Object.keys(SURV_GROUPS).map((g) => { const w = r.weeks[g]?.at(-1); return { group: g, count: w?.count ?? 0, baseline: w?.baseline ?? 0, surge: !!w?.surge }; });
    return json({ ok: true, data: { items, surges: items.filter((i) => i.surge).length } });
  }
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
  if (id === "critical_results") {
    const doc = await myDoctor();
    if (!doc) return json({ ok: true, data: { count: 0, results: [] } });
    const since = new Date(Math.min(from.getTime(), Date.now() - 7 * 86400e3)).toISOString();
    const { data: rows } = await db.from("orders").select("id, patient_id, verified_at, result, patients(full_name, mrn), lab_tests(code, name)").eq("hospital_id", H)
      .eq("doctor_id", doc).eq("status", "verified").eq("has_critical", true).gte("verified_at", since).order("verified_at", { ascending: false }).limit(50);
    // deno-lint-ignore no-explicit-any
    const results = (rows ?? []).map((r: any) => ({ order_id: r.id, patient_id: r.patient_id, name: r.patients?.full_name ?? "", mrn: r.patients?.mrn ?? "",
      test: r.lab_tests?.code ?? "", summary: r.result ?? "", verified_at: r.verified_at }));
    return json({ ok: true, data: { count: results.length, results: results.slice(0, 8) } });
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
  if (id === "my_duty") {
    // Today's shifts plus last night's shift if it is still running (Pakistan time).
    const today = pkDay(new Date());
    const yest = pkDay(new Date(Date.now() - 86400e3));
    const { data } = await db.from("roster_shifts").select("id, date, shift, start_time, end_time, checked_in_at, checked_out_at").eq("hospital_id", H).eq("user_id", c.userId).in("date", [yest, today]).order("date").order("start_time");
    // deno-lint-ignore no-explicit-any
    const shifts = (data ?? []).filter((s: any) => {
      if (s.date === today) return true;
      const end = new Date(`${s.date}T${s.end_time.slice(0, 5)}:00${TZ}`); const start = new Date(`${s.date}T${s.start_time.slice(0, 5)}:00${TZ}`);
      return (end <= start ? end.getTime() + 86400e3 : end.getTime()) > Date.now() || (s.checked_in_at && !s.checked_out_at);
    });
    return json({ ok: true, data: { shifts } });
  }
  if (id.startsWith("dept_")) {
    const s = await deptScope(db, c, null);
    if ("error" in s) return json({ ok: true, data: { no_department: true } });
    const docIds = s.doctors.map((d) => d.id);
    const name = new Map(s.doctors.map((d) => [d.id, d.name]));
    const F = from.toISOString(), T = to.toISOString();
    if (id === "dept_opd_by_doctor") {
      const by = new Map(s.doctors.map((d) => [d.id, { name: d.name, opd: 0, done: 0 }]));
      if (docIds.length) {
        const { data } = await db.from("appointments").select("doctor_id, status").eq("hospital_id", H).in("doctor_id", docIds)
          .gte("slot_start", F).lt("slot_start", T).not("status", "in", "(cancelled,needs_rebooking,no_show)").limit(10000);
        for (const a of data ?? []) { const e = by.get(a.doctor_id); if (e) { e.opd++; if (a.status === "done") e.done++; } }
      }
      return json({ ok: true, data: { department: s.dept.name, doctors: [...by.values()].sort((x, y) => y.opd - x.opd).slice(0, 12) } });
    }
    if (id === "dept_waiting_now") {
      const { data } = docIds.length ? await db.from("appointments").select("doctor_id, checked_in_at").eq("hospital_id", H).in("doctor_id", docIds)
        .gte("slot_start", todayStart.toISOString()).lt("slot_start", todayEnd.toISOString()).eq("status", "waiting").limit(2000) : { data: [] };
      const w = (data ?? []).map((x: { checked_in_at: string | null }) => (x.checked_in_at ? mins(x.checked_in_at) : 0));
      return json({ ok: true, data: { waiting: w.length, avg_wait_min: w.length ? Math.round(w.reduce((a: number, b: number) => a + b, 0) / w.length) : 0, longest_min: w.length ? Math.max(...w) : 0 } });
    }
    if (id === "dept_admissions") {
      const cnt = async (f: (q: DB) => DB) => { const { count } = await f(db.from("admissions").select("id", { count: "exact", head: true }).eq("hospital_id", H).eq("department_id", s.dept.id)); return count ?? 0; };
      return json({ ok: true, data: {
        current: await cnt((q) => q.eq("status", "admitted")),
        admitted: await cnt((q) => q.gte("admitted_at", F).lt("admitted_at", T)),
        discharged: await cnt((q) => q.gte("discharged_at", F).lt("discharged_at", T)) } });
    }
    if (id === "dept_top_diagnoses") {
      const diag = new Map<string, { code: string; description: string; count: number }>();
      if (docIds.length) {
        const { data: v } = await db.from("visits").select("id").eq("hospital_id", H).in("doctor_id", docIds).gte("created_at", F).lt("created_at", T).limit(10000);
        const vids = (v ?? []).map((x: { id: string }) => x.id);
        for (let i = 0; i < vids.length; i += 300) {
          const { data: dx } = await db.from("visit_diagnoses").select("icd10_code, description").in("visit_id", vids.slice(i, i + 300));
          for (const d of dx ?? []) { const k = d.icd10_code || d.description; const e = diag.get(k) ?? { code: d.icd10_code ?? "", description: d.description ?? "", count: 0 }; e.count++; diag.set(k, e); }
        }
      }
      return json({ ok: true, data: { items: [...diag.values()].sort((x, y) => y.count - x.count).slice(0, 5) } });
    }
    if (id === "dept_revenue") {
      const sumFor = async (f: string, t: string) => {
        const { data: lines } = await db.from("invoice_lines").select("amount, invoices!inner(visits(doctor_id), admissions(department_id, admitting_doctor_id))")
          .eq("hospital_id", H).gte("created_at", f).lt("created_at", t).limit(50000);
        let total = 0;
        // deno-lint-ignore no-explicit-any
        for (const l of (lines ?? []) as any[]) {
          const inv = l.invoices ?? {}; const d = inv.visits?.doctor_id ?? inv.admissions?.admitting_doctor_id ?? null;
          if ((d && name.has(d)) || inv.admissions?.department_id === s.dept.id) total += Number(l.amount);
        }
        return r2(total);
      };
      return json({ ok: true, data: { value: await sumFor(F, T), previous: await sumFor(prevFrom.toISOString(), F) } });
    }
    if (id === "dept_on_leave") {
      const today = pkDay(new Date());
      const { data: lv } = docIds.length ? await db.from("doctor_leaves").select("doctor_id, from_date, to_date, status, type").eq("hospital_id", H).in("doctor_id", docIds)
        .in("status", ["approved", "pending"]).gte("to_date", today).limit(500) : { data: [] };
      // deno-lint-ignore no-explicit-any
      const away = (lv ?? []).filter((l: any) => l.status === "approved" && l.from_date <= today).map((l: any) => ({ name: name.get(l.doctor_id) ?? "", to_date: l.to_date, type: l.type }));
      // deno-lint-ignore no-explicit-any
      const pending = (lv ?? []).filter((l: any) => l.status === "pending").length;
      return json({ ok: true, data: { count: away.length, doctors: away.slice(0, 8), pending } });
    }
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
