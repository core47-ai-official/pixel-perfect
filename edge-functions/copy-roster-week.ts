// Paste into Supabase → Edge Functions → new function "copy-roster-week". Turn "Enforce JWT Verification" OFF.
// Roster managers. Body: { to_week, from_week? (default the week before), confirm? }. Copies shifts for the caller's staff; same warnings as save.
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
// ---- roster helpers (MediCore; identical in every roster function) ---------
const SHIFTS = ["morning", "evening", "night", "on_call"];
const SHIFT_TIMES: Record<string, [string, string]> = { morning: ["08:00", "14:00"], evening: ["14:00", "20:00"], night: ["20:00", "08:00"], on_call: ["08:00", "08:00"] };
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: unknown) => typeof s === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(s);
const addDaysStr = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const todayPk = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
/** Monday of the week containing d. */
const weekStart = (d: string) => { const x = new Date(`${d}T00:00:00Z`); return addDaysStr(d, -((x.getUTCDay() + 6) % 7)); };
/** Shift start/end as instants (Pakistan time); an end at or before the start runs into the next day. */
function shiftSpan(s: { date: string; start_time: string; end_time: string }) {
  const start = new Date(`${s.date}T${s.start_time.slice(0, 5)}:00${TZ}`);
  let end = new Date(`${s.date}T${s.end_time.slice(0, 5)}:00${TZ}`);
  if (end <= start) end = new Date(end.getTime() + 86400e3);
  return { start, end };
}
interface Staff { user_id: string; name: string; roles: string[]; department_id: string | null; ward_ids: string[] }
/**
 * Who the caller can roster: admin → all hospital staff; dept_head → staff of their department;
 * ward in-charge nurse → nurses sharing one of their wards. Others manage nobody.
 */
async function rosterScope(db: DB, c: { userId: string; hospitalId: string; roles: string[] }) {
  const { data: rows } = await db.from("user_roles").select("user_id, role, department_id, ward_ids, is_in_charge").eq("hospital_id", c.hospitalId).neq("role", "patient");
  const mine = (rows ?? []).filter((r: { user_id: string }) => r.user_id === c.userId);
  const isAdmin = c.roles.some((r) => ["admin", "super_admin"].includes(r));
  // deno-lint-ignore no-explicit-any
  const headDept = mine.find((r: any) => r.role === "dept_head")?.department_id ?? null;
  // deno-lint-ignore no-explicit-any
  const chargeWards: string[] = mine.filter((r: any) => r.role === "nurse" && r.is_in_charge).flatMap((r: any) => r.ward_ids ?? []);
  const by = new Map<string, Staff>();
  for (const r of rows ?? []) {
    const e = by.get(r.user_id) ?? { user_id: r.user_id, name: "", roles: [], department_id: null, ward_ids: [] };
    e.roles.push(r.role); e.department_id = e.department_id ?? r.department_id ?? null;
    e.ward_ids = [...new Set([...e.ward_ids, ...(r.ward_ids ?? [])])];
    by.set(r.user_id, e);
  }
  // Doctors' department lives on the doctors row.
  const { data: docs } = await db.from("doctors").select("id, user_id, department_id").eq("hospital_id", c.hospitalId);
  const doctorOf = new Map<string, string>();
  for (const d of docs ?? []) { doctorOf.set(d.user_id, d.id); const e = by.get(d.user_id); if (e && !e.department_id) e.department_id = d.department_id; }
  const managed = [...by.values()].filter((s) => isAdmin
    || (headDept && s.department_id === headDept)
    || (chargeWards.length && s.roles.includes("nurse") && s.ward_ids.some((w) => chargeWards.includes(w))));
  const ids = managed.map((s) => s.user_id);
  for (let i = 0; i < ids.length; i += 300) {
    const { data: profs } = await db.from("profiles").select("id, full_name, is_active").in("id", ids.slice(i, i + 300));
    for (const p of profs ?? []) { const e = by.get(p.id); if (e) e.name = p.full_name ?? ""; }
  }
  return { isAdmin, headDept, chargeWards, canManage: isAdmin || !!headDept || chargeWards.length > 0, staff: managed.sort((a, b) => a.name.localeCompare(b.name)), doctorOf };
}
/** Approved leave per user id overlapping [from, to] (leave is recorded for doctors). */
async function leavesFor(db: DB, hospitalId: string, doctorOf: Map<string, string>, userIds: string[], from: string, to: string) {
  const docIds = userIds.map((u) => doctorOf.get(u)).filter(Boolean) as string[];
  const out: { user_id: string; from_date: string; to_date: string; type: string }[] = [];
  if (!docIds.length) return out;
  const userOf = new Map([...doctorOf.entries()].map(([u, d]) => [d, u]));
  const { data } = await db.from("doctor_leaves").select("doctor_id, from_date, to_date, type").eq("hospital_id", hospitalId).eq("status", "approved")
    .in("doctor_id", docIds).lte("from_date", to).gte("to_date", from);
  for (const l of data ?? []) out.push({ user_id: userOf.get(l.doctor_id)!, from_date: l.from_date, to_date: l.to_date, type: l.type });
  return out;
}
interface ShiftIn { user_id: string; date: string; shift: string; start_time: string; end_time: string; department_id: string | null; ward_id: string | null; note: string | null }
/** Warnings: more than one shift on a day, shifts that overlap or leave under 8 hours rest, and staff on approved leave. */
function rosterWarnings(shifts: ShiftIn[], leaves: { user_id: string; from_date: string; to_date: string }[], names: Map<string, string>) {
  const w: { kind: "double" | "rest" | "leave"; user_id: string; name: string; date: string; message: string }[] = [];
  const byUser = new Map<string, ShiftIn[]>();
  for (const s of shifts) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
  for (const [u, list] of byUser) {
    const name = names.get(u) ?? "";
    const perDay = new Map<string, number>();
    for (const s of list) perDay.set(s.date, (perDay.get(s.date) ?? 0) + 1);
    for (const [d, n] of perDay) if (n > 1) w.push({ kind: "double", user_id: u, name, date: d, message: `${name}: ${n} shifts on ${d}` });
    const spans = list.filter((s) => s.shift !== "on_call").map((s) => ({ s, ...shiftSpan(s) })).sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 1; i < spans.length; i++) {
      const gap = (spans[i].start.getTime() - spans[i - 1].end.getTime()) / 3600e3;
      if (gap < 8 && spans[i].s.date !== spans[i - 1].s.date) w.push({ kind: "rest", user_id: u, name, date: spans[i].s.date, message: `${name}: only ${Math.max(0, Math.round(gap))}h rest before ${spans[i].s.shift} on ${spans[i].s.date}` });
    }
    for (const s of list) for (const l of leaves) if (l.user_id === u && l.from_date <= s.date && l.to_date >= s.date)
      w.push({ kind: "leave", user_id: u, name, date: s.date, message: `${name} is on approved leave on ${s.date}` });
  }
  return w;
}
/** Replaces the managed staff's shifts for the 7 days from weekStart. Shifts already checked into are kept. */
async function replaceWeek(db: DB, c: { userId: string; hospitalId: string }, ws: string, userIds: string[], shifts: ShiftIn[]) {
  const we = addDaysStr(ws, 6);
  const { data: existing } = await db.from("roster_shifts").select("id, user_id, date, shift, checked_in_at").eq("hospital_id", c.hospitalId).gte("date", ws).lte("date", we).in("user_id", userIds);
  const keep = new Set((existing ?? []).filter((e: { checked_in_at: string | null }) => e.checked_in_at).map((e: { user_id: string; date: string; shift: string }) => `${e.user_id}|${e.date}|${e.shift}`));
  const del = (existing ?? []).filter((e: { checked_in_at: string | null }) => !e.checked_in_at).map((e: { id: string }) => e.id);
  for (let i = 0; i < del.length; i += 200) await db.from("roster_shifts").delete().in("id", del.slice(i, i + 200));
  const rows = shifts.filter((s) => !keep.has(`${s.user_id}|${s.date}|${s.shift}`)).map((s) => ({ ...s, hospital_id: c.hospitalId, created_by: c.userId }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("roster_shifts").insert(rows.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  return { saved: rows.length, kept: keep.size, removed: del.length };
}
// ---- end roster helpers ---------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const s = await rosterScope(db, c);
  if (!s.canManage) return fail("forbidden", "Only admins, department heads and ward in-charge nurses manage the roster.", 403);
  if (!isDate(b.to_week)) return fail("bad_request", "Choose the week to copy into.");
  const to = weekStart(b.to_week);
  const from = weekStart(isDate(b.from_week) ? b.from_week : addDaysStr(to, -7));
  if (from === to) return fail("bad_request", "Pick two different weeks.");
  const offset = Math.round((Date.parse(to) - Date.parse(from)) / 86400e3);
  const ids = s.staff.map((x) => x.user_id);
  // deno-lint-ignore no-explicit-any
  const src: any[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db.from("roster_shifts").select("user_id, date, shift, start_time, end_time, ward_id, department_id, note").eq("hospital_id", c.hospitalId)
      .gte("date", from).lte("date", addDaysStr(from, 6)).in("user_id", ids.slice(i, i + 300));
    src.push(...(data ?? []));
  }
  if (!src.length) return fail("empty", "There are no shifts in that week to copy.");
  const shifts: ShiftIn[] = src.map((x) => ({ ...x, date: addDaysStr(x.date, offset), start_time: x.start_time.slice(0, 5), end_time: x.end_time.slice(0, 5) }));
  const leaves = await leavesFor(db, c.hospitalId, s.doctorOf, ids, to, addDaysStr(to, 6));
  const warnings = rosterWarnings(shifts, leaves, new Map(s.staff.map((x) => [x.user_id, x.name])));
  if (warnings.length && !b.confirm) return json({ ok: true, data: { saved: false, needs_confirm: true, count: shifts.length, warnings } });
  try {
    const res = await replaceWeek(db, c, to, ids, shifts);
    await audit(db, req, c, "copy_roster", "roster_week", to, { from }, { ...res, warnings: warnings.length });
    return json({ ok: true, data: { saved: true, ...res, warnings } });
  } catch (_e) { return fail("server", "Could not copy the roster.", 500); }
});
