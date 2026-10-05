// Paste into Supabase → Edge Functions → new function "save-handover-note". Turn "Enforce JWT Verification" OFF.
// Nurse / doctor / dept head / admin: write a shift handover note. Body: { ward_id, shift_date (YYYY-MM-DD), shift: morning|evening|night, note }. Nurses only for their assigned wards.
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
const WRITERS = ["super_admin", "admin", "dept_head", "doctor", "nurse"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => WRITERS.includes(r))) return fail("forbidden", "You can't write handover notes.", 403);
  const b = await req.json().catch(() => ({}));
  const shift = String(b.shift ?? "");
  if (!["morning", "evening", "night"].includes(shift)) return fail("invalid", "Choose a shift.");
  const date = String(b.shift_date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("invalid", "Choose a date.");
  const note = String(b.note ?? "").trim().slice(0, 4000);
  if (note.length < 3) return fail("invalid", "Write the handover note.");
  const { data: ward } = await db.from("wards").select("id").eq("id", String(b.ward_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!ward) return fail("not_found", "Ward not found.", 404);
  if (!c.roles.some((r) => WRITERS.filter((x) => x !== "nurse").includes(r))) {
    const { data: rr } = await db.from("user_roles").select("ward_ids").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).eq("role", "nurse");
    if (!(rr ?? []).some((x: { ward_ids: string[] }) => (x.ward_ids ?? []).includes(ward.id))) return fail("forbidden", "You're not assigned to this ward.", 403);
  }
  const { data: prof } = await db.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const { data, error } = await db.from("handover_notes").insert({ hospital_id: c.hospitalId, ward_id: ward.id, shift_date: date, shift, note,
    written_by: c.userId, written_by_name: prof?.full_name ?? "", created_by: c.userId }).select().single();
  if (error) return fail("server", "Could not save the note.", 500);
  await audit(db, req, c, "create", "handover_note", data.id, null, data);
  return json({ ok: true, data });
});
