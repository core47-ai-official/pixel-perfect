// Paste into Supabase → Edge Functions → new function "call-next-token". Turn "Enforce JWT Verification" OFF.
// Doctor (self) or admin with doctor_id: finishes current patient, calls lowest waiting token.
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

const localDate = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 10);
const todayPk = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

/** Tells waiting-room TVs to refresh (Realtime broadcast; carries no patient data). */
async function refreshTv(db: DB, hospitalId: string) {
  try {
    const ch = db.channel(`tv-${hospitalId}`);
    await ch.send({ type: "broadcast", event: "refresh", payload: { at: Date.now() } });
    await db.removeChannel(ch);
  } catch { /* TVs also poll every 15 s */ }
}

// deno-lint-ignore no-explicit-any
async function audit(db: DB, req: Request, c: any, action: string, id: string, before: unknown, after: unknown) {
  await db.from("audit_logs").insert({
    hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action,
    resource: "appointment", resource_id: id, before, after, ip: req.headers.get("x-forwarded-for"),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  const b = await req.json().catch(() => ({}));
  // Doctors call their own queue; admin may call on behalf of a doctor (doctor_id given).
  let doctorId: string | null = null;
  if (b.doctor_id && c.roles.some((r) => ["admin", "super_admin"].includes(r))) doctorId = String(b.doctor_id);
  else if (c.roles.includes("doctor")) {
    const { data: me } = await db.from("doctors").select("id").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).maybeSingle();
    doctorId = me?.id ?? null;
  }
  if (!doctorId) return fail("forbidden", "Only doctors can call the next token.", 403);
  const day = todayPk();
  const now = new Date().toISOString();
  const range = (q: DB) => q.eq("hospital_id", c.hospitalId).eq("doctor_id", doctorId)
    .gte("slot_start", `${day}T00:00:00${TZ}`).lte("slot_start", `${day}T23:59:59${TZ}`);

  // Finish whoever is currently with the doctor.
  const { data: current } = await range(db.from("appointments").select("*")).eq("status", "in_consultation");
  for (const cur of current ?? []) {
    const { data: done } = await db.from("appointments").update({ status: "done", completed_at: now, updated_at: now })
      .eq("id", cur.id).eq("status", "in_consultation").select().single();
    if (done) await audit(db, req, c, "complete", cur.id, cur, done);
  }
  // Next waiting token (lowest number first).
  for (let i = 0; i < 5; i++) {
    const { data: next } = await range(db.from("appointments").select("*")).eq("status", "waiting")
      .order("token_no", { ascending: true }).limit(1).maybeSingle();
    if (!next) {
      await refreshTv(db, c.hospitalId);
      return json({ ok: true, data: null });
    }
    const { data: after } = await db.from("appointments").update({ status: "in_consultation", called_at: now, updated_at: now })
      .eq("id", next.id).eq("status", "waiting").select().single();
    if (!after) continue; // someone else took it; try the next one
    await db.from("doctors").update({ status: "in_opd", updated_at: now }).eq("id", doctorId);
    await audit(db, req, c, "call_token", next.id, next, after);
    await refreshTv(db, c.hospitalId);
    const { data: p } = await db.from("patients").select("full_name, mrn").eq("id", next.patient_id).maybeSingle();
    return json({ ok: true, data: { ...after, patient: p } });
  }
  return fail("conflict", "The queue changed meanwhile. Try again.", 409);
});
