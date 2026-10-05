// Paste into Supabase → Edge Functions → new function "upsert-package". Turn "Enforce JWT Verification" OFF.
// Admin. Body: { id?, name, description?, price, tariff_codes: string[], valid_days, is_active? }. Every code must be an existing tariff.
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
const BOOT = async (req: Request) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  const b = await req.json().catch(() => ({}));
  return { db, c, b };
};
const has = (c: { roles: string[] }, list: string[]) => c.roles.some((r) => list.includes(r));
const CATEGORIES = ["consultation", "lab", "radiology", "room", "procedure", "ot", "pharmacy", "other"];
const ROOM_CLASSES = ["general", "semi_private", "private", "hdu", "icu", "nicu", "isolation", "er"];
const ADMIN = ["admin", "super_admin"];
// deno-lint-ignore no-explicit-any
function cleanTariff(b: any): { row?: Record<string, unknown>; error?: string } {
  const code = String(b.code ?? "").trim().toUpperCase().replace(/\s+/g, "-").slice(0, 30);
  const name = String(b.name ?? "").trim().slice(0, 200);
  if (!code || !/^[A-Z0-9._-]+$/.test(code)) return { error: "Code is required (letters, numbers, - . _ only)." };
  if (name.length < 2) return { error: "Name is required." };
  const category = String(b.category ?? "other").trim().toLowerCase();
  if (!CATEGORIES.includes(category)) return { error: `Unknown category "${category}".` };
  const price = Number(String(b.price ?? "").replace(/,/g, ""));
  if (!Number.isFinite(price) || price < 0 || price > 99999999) return { error: "Price must be a number, 0 or more." };
  const rc = String(b.room_class ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (rc && !ROOM_CLASSES.includes(rc)) return { error: `Unknown room class "${rc}".` };
  const active = typeof b.is_active === "string" ? !["false", "no", "0", "inactive"].includes(b.is_active.trim().toLowerCase()) : b.is_active !== false;
  return { row: { code, name, category, room_class: rc || null, price: Math.round(price * 100) / 100, is_active: active } };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ADMIN)) return fail("forbidden", "Only an admin can change tariffs.", 403);
  const name = String(b.name ?? "").trim().slice(0, 200);
  if (name.length < 2) return fail("invalid", "Name is required.");
  const price = Number(b.price);
  if (!Number.isFinite(price) || price < 0 || price > 99999999) return fail("invalid", "Price must be 0 or more.");
  const days = Math.round(Number(b.valid_days));
  if (!Number.isFinite(days) || days < 1 || days > 365) return fail("invalid", "Valid days must be between 1 and 365.");
  const codes = [...new Set((Array.isArray(b.tariff_codes) ? b.tariff_codes : []).map((x: unknown) => String(x).trim().toUpperCase()).filter(Boolean))] as string[];
  if (!codes.length) return fail("invalid", "Add at least one tariff to the package.");
  if (codes.length > 100) return fail("invalid", "At most 100 tariffs per package.");
  const { data: found } = await db.from("tariffs").select("code").eq("hospital_id", c.hospitalId).in("code", codes);
  const ok = new Set((found ?? []).map((x: { code: string }) => x.code.toUpperCase()));
  const missing = codes.filter((x) => !ok.has(x));
  if (missing.length) return fail("invalid", `Unknown tariff codes: ${missing.join(", ")}`);
  const row = { name, description: String(b.description ?? "").trim().slice(0, 1000), price: Math.round(price * 100) / 100, tariff_codes: codes, valid_days: days, is_active: b.is_active !== false, updated_at: new Date().toISOString() };
  let before = null;
  let res;
  if (b.id) {
    const { data: old } = await db.from("packages").select("*").eq("id", String(b.id)).eq("hospital_id", c.hospitalId).maybeSingle();
    if (!old) return fail("not_found", "Package not found.", 404);
    before = old;
    res = await db.from("packages").update(row).eq("id", old.id).select().single();
  } else {
    res = await db.from("packages").insert({ ...row, hospital_id: c.hospitalId, created_by: c.userId }).select().single();
  }
  if (res.error) return fail(res.error.code === "23505" ? "duplicate" : "server", res.error.code === "23505" ? "A package with this name already exists." : "Could not save.", res.error.code === "23505" ? 409 : 500);
  await audit(db, req, c, b.id ? "update" : "create", "package", res.data.id, before, res.data);
  return json({ ok: true, data: res.data });
});
