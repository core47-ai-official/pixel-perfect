// Paste into Supabase → Edge Functions → new function "stock-alerts". Turn "Enforce JWT Verification" OFF.
// Scheduled daily at 08:00 Pakistan time (03:00 UTC) by Supabase Cron, header x-cron-key = CRON_SECRET (same secret as the other daily jobs).
// Queues one low-stock and one expiring-batches notification per hospital to pharmacists and admins.
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

const now = () => new Date().toISOString();
const todayPk = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const daysUntil = (ymd: string) => Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${todayPk()}T00:00:00Z`)) / 86400e3);
const medName = (m: { generic_name: string; brand_name: string | null; strength: string | null }) =>
  [m.brand_name || m.generic_name, m.strength].filter(Boolean).join(" ");
/** Notifies every pharmacist and admin in the hospital. */
async function notifyStock(db: DB, hospitalId: string, type: string, title: string, body: string, by: string | null) {
  const { data: staff } = await db.from("user_roles").select("user_id").eq("hospital_id", hospitalId).in("role", ["pharmacist", "admin"]);
  const ids = [...new Set((staff ?? []).map((x: { user_id: string }) => x.user_id))];
  if (ids.length) await db.from("notifications").insert(ids.map((u) => ({ hospital_id: hospitalId, user_id: u, type, title, body: body.slice(0, 1000), link: "/inventory", created_by: by })));
  return ids.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-key") !== secret) return fail("forbidden", "Not allowed.", 403);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const limit = new Date(Date.parse(`${todayPk()}T00:00:00Z`) + 90 * 86400e3).toISOString().slice(0, 10);
  const { data: hospitals } = await db.from("hospitals").select("id");
  const out = [];
  for (const h of hospitals ?? []) {
    const { data: meds } = await db.from("medicines").select("id, generic_name, brand_name, strength, reorder_level").eq("hospital_id", h.id).eq("is_active", true).gt("reorder_level", 0);
    const { data: batches } = await db.from("stock_batches").select("medicine_id, batch_no, expiry_date, qty_on_hand").eq("hospital_id", h.id).gt("qty_on_hand", 0);
    const today = todayPk();
    const onHand = new Map<string, number>();
    for (const x of batches ?? []) if (x.expiry_date >= today) onHand.set(x.medicine_id, (onHand.get(x.medicine_id) ?? 0) + x.qty_on_hand);
    const low = (meds ?? []).filter((m: { id: string; reorder_level: number }) => (onHand.get(m.id) ?? 0) < m.reorder_level);
    const expiring = (batches ?? []).filter((x: { expiry_date: string }) => x.expiry_date <= limit).sort((a: { expiry_date: string }, b: { expiry_date: string }) => a.expiry_date.localeCompare(b.expiry_date));
    if (low.length) await notifyStock(db, h.id, "stock_low", `${low.length} medicine(s) below reorder level`,
      low.slice(0, 15).map((m: any) => `${medName(m)}: ${onHand.get(m.id) ?? 0} (reorder at ${m.reorder_level})`).join("; "), null);
    if (expiring.length) {
      const { data: names } = await db.from("medicines").select("id, generic_name, brand_name, strength").in("id", [...new Set(expiring.map((x: any) => x.medicine_id))]);
      const nm = new Map((names ?? []).map((m: any) => [m.id, medName(m)]));
      await notifyStock(db, h.id, "stock_expiring", `${expiring.length} batch(es) expire within 90 days`,
        expiring.slice(0, 15).map((x: any) => `${nm.get(x.medicine_id)} ${x.batch_no}: ${x.expiry_date} (${daysUntil(x.expiry_date)} d)`).join("; "), null);
    }
    out.push({ hospital_id: h.id, low: low.length, expiring: expiring.length });
  }
  return json({ ok: true, data: out });
});
