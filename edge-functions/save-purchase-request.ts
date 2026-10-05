// Paste into Supabase → Edge Functions → new function "save-purchase-request". Turn "Enforce JWT Verification" OFF.
// Pharmacist / admin: create or edit a draft. Body: { id?, items: [{ medicine_id, qty, note? }], note?, supplier_id? }
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

const STOCK_ROLES = ["super_admin", "admin", "pharmacist"];
const ADMIN_ROLES = ["super_admin", "admin"];
const now = () => new Date().toISOString();
const todayPk = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const daysUntil = (ymd: string) => Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${todayPk()}T00:00:00Z`)) / 86400e3);
async function notify(db: DB, hospitalId: string, userIds: string[], type: string, title: string, body: string, by: string | null) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length) await db.from("notifications").insert(ids.map((u) => ({ hospital_id: hospitalId, user_id: u, type, title, body: body.slice(0, 1000), link: "/purchase-requests", created_by: by })));
}
async function staffWith(db: DB, hospitalId: string, roles: string[]) {
  const { data } = await db.from("user_roles").select("user_id").eq("hospital_id", hospitalId).in("role", roles);
  return (data ?? []).map((x: { user_id: string }) => x.user_id);
}
async function loadPr(db: DB, hospitalId: string, id: unknown) {
  const { data } = await db.from("purchase_requests").select("*").eq("id", String(id ?? "")).eq("hospital_id", hospitalId).maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, STOCK_ROLES)) return fail("forbidden", "Only a pharmacist or admin can make purchase requests.", 403);
  const raw = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
  const ids = [...new Set(raw.map((i: { medicine_id?: string }) => String(i.medicine_id ?? "")))];
  const { data: meds } = ids.length ? await db.from("medicines").select("id, generic_name, brand_name, strength, form").eq("hospital_id", c.hospitalId).in("id", ids) : { data: [] };
  const medMap = new Map((meds ?? []).map((m: { id: string }) => [m.id, m]));
  const items = [];
  const seen = new Set<string>();
  for (const i of raw) {
    // deno-lint-ignore no-explicit-any
    const m: any = medMap.get(String(i.medicine_id ?? ""));
    if (!m) return fail("invalid", "Unknown medicine in the list.");
    if (seen.has(m.id)) return fail("invalid", `${m.generic_name} is listed twice.`);
    seen.add(m.id);
    const qty = Math.round(Number(i.qty));
    if (!(qty > 0 && qty <= 1_000_000)) return fail("invalid", `Enter a quantity for ${m.generic_name}.`);
    items.push({ medicine_id: m.id, medicine_name: [m.brand_name || m.generic_name, m.strength].filter(Boolean).join(" "), qty, note: i.note ? String(i.note).slice(0, 200) : null });
  }
  if (!items.length) return fail("invalid", "Add at least one medicine.");
  let supplierId = null;
  if (b.supplier_id) {
    const { data: s } = await db.from("suppliers").select("id").eq("id", String(b.supplier_id)).eq("hospital_id", c.hospitalId).maybeSingle();
    if (!s) return fail("not_found", "Supplier not found.", 404);
    supplierId = s.id;
  }
  const fields = { items, note: b.note ? String(b.note).slice(0, 500) : null, supplier_id: supplierId, updated_at: now() };
  if (b.id) {
    const pr = await loadPr(db, c.hospitalId, b.id);
    if (!pr) return fail("not_found", "Request not found.", 404);
    if (pr.status !== "draft") return fail("locked", "Only a draft can be edited.", 409);
    const { data } = await db.from("purchase_requests").update(fields).eq("id", pr.id).eq("status", "draft").select().maybeSingle();
    if (!data) return fail("stale", "This request just changed. Refresh.", 409);
    await audit(db, req, c, "update", "purchase_request", pr.id, pr, data);
    return json({ ok: true, data });
  }
  const { data, error } = await db.from("purchase_requests").insert({ ...fields, hospital_id: c.hospitalId, requested_by: c.userId, status: "draft" }).select().single();
  if (error) return fail("server", "Could not save.", 500);
  await audit(db, req, c, "create", "purchase_request", data.id, null, data);
  return json({ ok: true, data });
});
