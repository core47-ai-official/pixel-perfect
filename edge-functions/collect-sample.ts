// Paste into Supabase → Edge Functions → new function "collect-sample". Turn "Enforce JWT Verification" OFF.
// lab_tech or admin: marks a lab order's sample as collected and gives it a unique Code 128 barcode. Body: { order_id }
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

// ---- billing helpers (MediCore) -------------------------------------------

const LAB_ROLES = ["lab_tech", "admin", "super_admin"];
// Barcode: L + PKT date (YYMMDD) + 4 random chars; only Code 128-safe characters.
function makeBarcode() {
  const d = new Date(Date.now() + 5 * 3600e3).toISOString().slice(2, 10).replace(/-/g, "");
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let r = ""; for (let i = 0; i < 4; i++) r += abc[Math.floor(Math.random() * abc.length)];
  return `L${d}${r}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => LAB_ROLES.includes(r))) return fail("forbidden", "Only lab staff can collect samples.", 403);
  const b = await req.json().catch(() => ({}));
  const { data: o } = await db.from("orders").select("*").eq("id", String(b.order_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!o) return fail("not_found", "Order not found.", 404);
  if (!["ordered", "rejected"].includes(o.status)) return fail("invalid", "This order's sample is already collected or the order is closed.", 409);
  const now = new Date().toISOString();
  for (let i = 0; i < 5; i++) {
    const sample_barcode = makeBarcode();
    // compare-and-set on status so two lab techs can't collect the same order twice
    const { data, error } = await db.from("orders").update({ status: "collected", sample_barcode, collected_by: c.userId, collected_at: now, updated_at: now })
      .eq("id", o.id).eq("status", o.status).select("*, lab_tests(code, name, category, sample_type), patients(full_name, mrn, print_language, dob, gender)").maybeSingle();
    if (error?.code === "23505") continue; // barcode clash, try another
    if (error) return fail("server", "Couldn't save the sample.", 500);
    if (!data) return fail("invalid", "The order changed meanwhile. Refresh and try again.", 409);
    await audit(db, req, c, "collect_sample", "order", o.id, o, data);
    return json({ ok: true, data });
  }
  return fail("server", "Couldn't generate a barcode. Try again.", 500);
});
