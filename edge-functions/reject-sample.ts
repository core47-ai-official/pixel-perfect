// Paste into Supabase → Edge Functions → new function "reject-sample". Turn "Enforce JWT Verification" OFF.
// lab_tech or admin: rejects a collected sample with a reason; the order can then be collected again. Body: { order_id, reason }
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
async function notify(db: DB, hospitalId: string, userIds: string[], type: string, title: string, body: string, by: string | null) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length) await db.from("notifications").insert(ids.map((u) => ({ hospital_id: hospitalId, user_id: u, type, title, body: body.slice(0, 1000), link: "/purchase-requests", created_by: by })));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => LAB_ROLES.includes(r))) return fail("forbidden", "Only lab staff can reject samples.", 403);
  const b = await req.json().catch(() => ({}));
  const reason = String(b.reason ?? "").trim().slice(0, 500);
  if (reason.length < 3) return fail("invalid", "A reason is required.");
  const { data: o } = await db.from("orders").select("*, lab_tests(name)").eq("id", String(b.order_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!o) return fail("not_found", "Order not found.", 404);
  if (o.status !== "collected") return fail("invalid", "Only collected samples can be rejected.", 409);
  const now = new Date().toISOString();
  const { data, error } = await db.from("orders").update({ status: "rejected", rejected_reason: reason, rejected_by: c.userId, rejected_at: now, updated_at: now })
    .eq("id", o.id).eq("status", "collected").select().maybeSingle();
  if (error || !data) return fail("invalid", "The order changed meanwhile.", 409);
  await audit(db, req, c, "reject_sample", "order", o.id, o, data);
  if (o.doctor_id) {
    const { data: doc } = await db.from("doctors").select("user_id").eq("id", o.doctor_id).maybeSingle();
    if (doc?.user_id) await notify(db, c.hospitalId, [doc.user_id], "sample_rejected", "Lab sample rejected",
      `${o.lab_tests?.name ?? "Lab test"}: ${reason}. A new sample is needed.`, c.userId).catch(() => null);
  }
  return json({ ok: true, data });
});
