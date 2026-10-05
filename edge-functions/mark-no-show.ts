// Paste into Supabase → Edge Functions → new function "mark-no-show". Turn "Enforce JWT Verification" OFF.
// Reception/admin, or the doctor for own patients: → no_show.
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
  const { data: before } = await db.from("appointments").select("*").eq("id", String(b.appointment_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!before) return fail("not_found", "Appointment not found.", 404);
  let allowed = c.roles.some((r) => ["receptionist", "admin", "super_admin"].includes(r));
  if (!allowed && c.roles.includes("doctor")) {
    const { data: me } = await db.from("doctors").select("id").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).maybeSingle();
    allowed = me?.id === before.doctor_id;
  }
  if (!allowed) return fail("forbidden", "You can't mark this appointment.", 403);
  if (!["booked", "waiting", "in_consultation"].includes(before.status)) return fail("conflict", "This appointment can't be marked as no-show.", 409);
  if (new Date(before.slot_start).getTime() > Date.now() && before.status === "booked") return fail("validation", "The appointment time hasn't come yet.");
  const now = new Date().toISOString();
  const { data: after, error } = await db.from("appointments").update({ status: "no_show", updated_at: now })
    .eq("id", before.id).eq("status", before.status).select().single();
  if (error || !after) return fail("conflict", "The appointment changed meanwhile. Refresh and try again.", 409);
  await audit(db, req, c, "no_show", before.id, before, after);
  await refreshTv(db, c.hospitalId);
  return json({ ok: true, data: after });
});
