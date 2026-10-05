// Paste into Supabase → Edge Functions → new function "receive-purchase-request". Turn "Enforce JWT Verification" OFF.
// Pharmacist / admin: receive an approved request into stock (same checks as receive-stock). Body: { id, supplier_id?, receipts: [{ medicine_id, batch_no, expiry_date, qty, cost_price }] }
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
  if (!has(c, STOCK_ROLES)) return fail("forbidden", "Only a pharmacist or admin can receive stock.", 403);
  const pr = await loadPr(db, c.hospitalId, b.id);
  if (!pr) return fail("not_found", "Request not found.", 404);
  if (pr.status !== "approved") return fail("locked", "Only an approved request can be received.", 409);
  const allowed = new Set((pr.items ?? []).map((i: { medicine_id: string }) => i.medicine_id));
  const receipts = Array.isArray(b.receipts) ? b.receipts.slice(0, 400) : [];
  let supplierId = pr.supplier_id;
  if (b.supplier_id) {
    const { data: s } = await db.from("suppliers").select("id").eq("id", String(b.supplier_id)).eq("hospital_id", c.hospitalId).maybeSingle();
    if (!s) return fail("not_found", "Supplier not found.", 404);
    supplierId = s.id;
  }
  // Validate every line first (receive-stock rules), then write.
  const rows = [];
  const keys = new Set<string>();
  for (const r of receipts) {
    const mid = String(r.medicine_id ?? "");
    if (!allowed.has(mid)) return fail("invalid", "A medicine is not on this request.");
    const batch = String(r.batch_no ?? "").trim().slice(0, 60);
    const expiry = String(r.expiry_date ?? "");
    const qty = Math.round(Number(r.qty)), cost = Math.round(Number(r.cost_price ?? 0) * 100) / 100;
    const name = (pr.items.find((i: { medicine_id: string }) => i.medicine_id === mid) ?? {}).medicine_name ?? "medicine";
    if (!(qty > 0)) continue;
    if (!batch) return fail("invalid", `${name}: batch number is required.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || isNaN(Date.parse(expiry))) return fail("invalid", `${name}: enter a valid expiry date.`);
    if (daysUntil(expiry) < 0) return fail("expired", `${name}: this batch has already expired.`);
    if (qty > 1_000_000) return fail("invalid", `${name}: check the quantity.`);
    if (!(cost >= 0)) return fail("invalid", `${name}: check the cost price.`);
    const k = `${mid}|${batch.toLowerCase()}`;
    if (keys.has(k)) return fail("invalid", `${name}: batch ${batch} is entered twice.`);
    keys.add(k);
    rows.push({ hospital_id: c.hospitalId, medicine_id: mid, batch_no: batch, expiry_date: expiry, qty_received: qty, qty_on_hand: qty,
      cost_price: cost, supplier_id: supplierId, received_by: c.userId, _name: name });
  }
  if (!rows.length) return fail("invalid", "Enter at least one batch received.");
  // Claim the request first so two people can't receive it twice.
  const { data: claimed } = await db.from("purchase_requests").update({ status: "received", received_by: c.userId, received_at: now(), updated_at: now() })
    .eq("id", pr.id).eq("status", "approved").select().maybeSingle();
  if (!claimed) return fail("stale", "This request was just received by someone else.", 409);
  const created: { id: string; medicine_id: string; batch_no: string; qty: number; expiry_date: string }[] = [];
  for (const r of rows) {
    const { _name, ...row } = r;
    const { data, error } = await db.from("stock_batches").insert(row).select("id, medicine_id, batch_no, qty_on_hand, expiry_date").single();
    if (error) {
      // Undo: remove batches added so far and reopen the request.
      if (created.length) await db.from("stock_batches").delete().in("id", created.map((x) => x.id));
      await db.from("purchase_requests").update({ status: "approved", received_by: null, received_at: null, updated_at: now() }).eq("id", pr.id);
      return fail(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? `${_name}: batch ${row.batch_no} was already received. Use a different batch number.` : "Could not save. Nothing was added to stock.", error.code === "23505" ? 409 : 500);
    }
    created.push({ id: data.id, medicine_id: data.medicine_id, batch_no: data.batch_no, qty: data.qty_on_hand, expiry_date: data.expiry_date });
  }
  const { data } = await db.from("purchase_requests").update({ received_batches: created }).eq("id", pr.id).select().single();
  const soon = rows.filter((r) => daysUntil(r.expiry_date) <= 90);
  if (soon.length) {
    const staff = await staffWith(db, c.hospitalId, ["pharmacist", "admin"]);
    const ids = [...new Set(staff)];
    if (ids.length) await db.from("notifications").insert(ids.map((u) => ({ hospital_id: c.hospitalId, user_id: u, type: "stock_expiring",
      title: "Received batches expire within 90 days", body: soon.map((r) => `${r._name} — batch ${r.batch_no}, expires ${r.expiry_date}`).join("; ").slice(0, 1000), link: "/inventory", created_by: c.userId })));
  }
  await audit(db, req, c, "receive", "purchase_request", pr.id, pr, data);
  return json({ ok: true, data });
});
