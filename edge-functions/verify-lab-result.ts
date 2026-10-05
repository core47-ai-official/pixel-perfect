// Paste into Supabase → Edge Functions → new function "verify-lab-result". Turn "Enforce JWT Verification" OFF.
// Senior lab tech / pathologist (user_roles.can_verify_lab on a lab_tech role): verifies a resulted order.
// Any critical value queues an urgent push notification to the ordering doctor. Body: { order_id }
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  const { data: ver } = await db.from("user_roles").select("id").eq("user_id", c.userId).eq("hospital_id", c.hospitalId)
    .eq("role", "lab_tech").eq("can_verify_lab", true).maybeSingle();
  if (!ver) return fail("forbidden", "Only a senior lab tech or pathologist can verify results.", 403);
  const b = await req.json().catch(() => ({}));
  const { data: o } = await db.from("orders").select("*, lab_tests(code, name), patients(full_name, mrn)").eq("id", String(b.order_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!o) return fail("not_found", "Order not found.", 404);
  if (o.status !== "resulted") return fail("invalid", "Only entered results can be verified.", 409);
  const { data: vals } = await db.from("lab_result_values").select("parameter, value, unit, flag").eq("order_id", o.id).order("sort");
  // deno-lint-ignore no-explicit-any
  const critical = (vals ?? []).filter((v: any) => v.flag === "critical");
  const now = new Date().toISOString();
  const { data: upd, error } = await db.from("orders").update({ status: "verified", verified_at: now, verified_by: c.userId, has_critical: critical.length > 0, updated_at: now })
    .eq("id", o.id).eq("status", "resulted").select().maybeSingle();
  if (error || !upd) return fail("invalid", "The order changed meanwhile.", 409);
  await audit(db, req, c, "verify_result", "order", o.id, o, upd);
  let notified = false;
  if (critical.length && o.doctor_id) {
    const { data: doc } = await db.from("doctors").select("user_id").eq("id", o.doctor_id).maybeSingle();
    if (doc?.user_id) {
      // deno-lint-ignore no-explicit-any
      const what = critical.map((v: any) => `${v.parameter} ${v.value}${v.unit ? " " + v.unit : ""}`).join(", ");
      const { error: ne } = await db.from("notifications").insert({ hospital_id: c.hospitalId, user_id: doc.user_id, type: "critical_result", channel: "push",
        title: `URGENT: critical result — ${o.patients?.full_name ?? "patient"}`,
        body: `${o.lab_tests?.code ?? "Lab"} (MRN ${o.patients?.mrn ?? ""}): ${what}`.slice(0, 1000),
        link: `/patients/${o.patient_id}`, created_by: c.userId });
      notified = !ne;
    }
  }
  return json({ ok: true, data: { order: upd, critical: critical.length, notified } });
});
