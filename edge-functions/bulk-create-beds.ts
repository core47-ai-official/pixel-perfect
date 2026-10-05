// Paste into Supabase → Edge Functions → new function "bulk-create-beds". Turn "Enforce JWT Verification" OFF.
// Admin / super_admin: create many beds at once, e.g. A1–A20. Body: { ward_id, prefix, from, to, bed_class, daily_rate, has_oxygen, has_ventilator }. Labels that already exist are skipped.
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
const CLASSES = ["general", "semi_private", "private", "hdu", "icu", "nicu", "isolation", "er"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => ["admin", "super_admin"].includes(r))) return fail("forbidden", "Only an admin can add beds.", 403);
  const b = await req.json().catch(() => ({}));
  const { data: ward } = await db.from("wards").select("id").eq("id", String(b.ward_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!ward) return fail("not_found", "Ward not found.", 404);
  const prefix = String(b.prefix ?? "").trim().toUpperCase().slice(0, 10);
  const from = Number(b.from), to = Number(b.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to - from >= 200) return fail("invalid", "Numbers must be a range of up to 200 beds.");
  if (!CLASSES.includes(b.bed_class)) return fail("invalid", "Unknown bed class.");
  const rate = Number(b.daily_rate ?? 0);
  if (!Number.isFinite(rate) || rate < 0) return fail("invalid", "Daily rate must be 0 or more.");
  const { data: existing } = await db.from("beds").select("label").eq("ward_id", ward.id);
  const taken = new Set((existing ?? []).map((x: { label: string }) => x.label.toUpperCase()));
  const rows = [];
  for (let n = from; n <= to; n++) {
    const label = `${prefix}${n}`;
    if (taken.has(label)) continue;
    rows.push({ hospital_id: c.hospitalId, ward_id: ward.id, label, bed_class: b.bed_class, daily_rate: Math.round(rate * 100) / 100,
      status: "free", has_oxygen: !!b.has_oxygen, has_ventilator: !!b.has_ventilator, created_by: c.userId });
  }
  if (rows.length) {
    const { error } = await db.from("beds").insert(rows);
    if (error) return fail("server", "Could not create beds.", 500);
  }
  await audit(db, req, c, "bulk_create", "bed", ward.id, null, { prefix, from, to, created: rows.length });
  return json({ ok: true, data: { created: rows.length, skipped: to - from + 1 - rows.length } });
});
