// Paste into Supabase → Edge Functions → new function "get-tv-queue". Turn "Enforce JWT Verification" OFF.
// Public waiting-room screen data, protected by the display token.
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

// PUBLIC: no sign-in. Caller must send the display token from Company settings → OPD.
// Returns token numbers only — never patient names.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const b = await req.json().catch(() => ({}));
  const token = String(b.display_token ?? "");
  if (token.length < 8) return fail("unauthorized", "Display token missing.", 401);

  let hospitalId: string | null = null;
  let doctorIds: string[] = [];
  let title: string | null = null;
  if (b.doctor_id) {
    const { data: d } = await db.from("doctors").select("id, hospital_id").eq("id", String(b.doctor_id)).maybeSingle();
    if (d) { hospitalId = d.hospital_id; doctorIds = [d.id]; }
  } else if (b.department_id) {
    const { data: dep } = await db.from("departments").select("id, hospital_id, name").eq("id", String(b.department_id)).maybeSingle();
    if (dep) {
      hospitalId = dep.hospital_id; title = dep.name;
      const { data: ds } = await db.from("doctors").select("id").eq("department_id", dep.id);
      doctorIds = (ds ?? []).map((x: { id: string }) => x.id);
    }
  }
  if (!hospitalId) return fail("not_found", "Screen not found.", 404);
  const [{ data: s }, { data: hosp }] = await Promise.all([
    db.from("company_settings").select("opd, general, branding").eq("hospital_id", hospitalId).maybeSingle(),
    db.from("hospitals").select("name").eq("id", hospitalId).maybeSingle(),
  ]);
  const expected = String(s?.opd?.tv_display_token ?? "");
  if (!expected || expected !== token) return fail("unauthorized", "This screen's display token is wrong or was changed.", 401);

  const avg = Number(s?.opd?.avg_consult_minutes ?? 10) || 10;
  const day = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const [{ data: docs }, { data: appts }, { data: sched }] = await Promise.all([
    doctorIds.length ? db.from("doctors").select("id, user_id, specialty, status").in("id", doctorIds) : { data: [] },
    doctorIds.length ? db.from("appointments").select("doctor_id, token_no, status, called_at").in("doctor_id", doctorIds)
      .in("status", ["waiting", "in_consultation"])
      .gte("slot_start", `${day}T00:00:00${TZ}`).lte("slot_start", `${day}T23:59:59${TZ}`) : { data: [] },
    doctorIds.length ? db.from("doctor_schedules").select("doctor_id, room").in("doctor_id", doctorIds)
      .eq("weekday", new Date(`${day}T12:00:00${TZ}`).getUTCDay()) : { data: [] },
  ]);
  const userIds = (docs ?? []).map((d: { user_id: string }) => d.user_id);
  const { data: profs } = userIds.length ? await db.from("profiles").select("id, full_name").in("id", userIds) : { data: [] };
  // deno-lint-ignore no-explicit-any
  const doctors = (docs ?? []).map((d: any) => {
    // deno-lint-ignore no-explicit-any
    const mine = (appts ?? []).filter((a: any) => a.doctor_id === d.id);
    // deno-lint-ignore no-explicit-any
    const serving = mine.filter((a: any) => a.status === "in_consultation").sort((a: any, b: any) => (b.called_at ?? "").localeCompare(a.called_at ?? ""))[0];
    // deno-lint-ignore no-explicit-any
    const waiting = mine.filter((a: any) => a.status === "waiting").map((a: any) => a.token_no).sort((a: number, b: number) => a - b);
    return {
      id: d.id, name: profs?.find((p: { id: string }) => p.id === d.user_id)?.full_name ?? "", specialty: d.specialty, status: d.status,
      // deno-lint-ignore no-explicit-any
      room: sched?.find((x: any) => x.doctor_id === d.id)?.room ?? null,
      now_serving: serving?.token_no ?? null, waiting, waiting_count: waiting.length,
    };
  });
  return json({ ok: true, data: {
    hospital_id: hospitalId, hospital_name: s?.general?.hospital_name || hosp?.name || "", logo: s?.branding?.logo || null,
    title, avg_consult_minutes: avg, doctors, server_time: new Date().toISOString(),
  } });
});
