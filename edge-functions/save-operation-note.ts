// Paste into Supabase → Edge Functions → new function "save-operation-note". Turn "Enforce JWT Verification" OFF.
// Surgeon / anesthetist / OT team (or admin): save the operation note. Body: { booking_id, anesthesia_note?, operation_note?, findings?, complications? }
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
async function onTeam(db: DB, userId: string, bk: Booking) {
  const ids = [bk.surgeon_id, bk.anesthetist_id, ...(bk.team_ids ?? [])].filter(Boolean);
  const { data } = await db.from("doctors").select("id").eq("user_id", userId).in("id", ids);
  return !!data?.length;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const bk = await loadBooking(db, c.hospitalId, b.booking_id);
  if (!bk) return fail("not_found", "Booking not found.", 404);
  if (!has(c, ["super_admin", "admin"]) && !(await onTeam(db, c.userId, bk))) return fail("forbidden", "Only the operating team can write the operation note.", 403);
  if (bk.status === "cancelled") return fail("invalid", "This case was cancelled.");
  const txt = (v: unknown) => (v == null ? null : String(v).slice(0, 8000));
  const { data: old } = await db.from("operation_notes").select("*").eq("booking_id", bk.id).maybeSingle();
  const { data, error } = await db.from("operation_notes").upsert({
    hospital_id: c.hospitalId, booking_id: bk.id, anesthesia_note: txt(b.anesthesia_note), operation_note: txt(b.operation_note),
    findings: txt(b.findings), complications: txt(b.complications), written_by: c.userId, updated_at: now(),
  }, { onConflict: "booking_id" }).select().single();
  if (error) return fail("server", "Could not save the note.", 500);
  await audit(db, req, c, old ? "update" : "create", "operation_note", data.id, old, data);
  return json({ ok: true, data });
});
