// Paste into Supabase → Edge Functions → new function "import-tariffs". Turn "Enforce JWT Verification" OFF.
// Admin. Body: { rows: [{ code, name, category, department?, room_class?, price, is_active? }], dry_run? }. Updates tariffs with the same code; department matched by name. Max 5000 rows.
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
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return fail("invalid", "The file has no rows.");
  if (rows.length > 5000) return fail("invalid", "At most 5000 rows per import.");
  const { data: depts } = await db.from("departments").select("id, name").eq("hospital_id", c.hospitalId);
  const deptByName = new Map((depts ?? []).map((d: { id: string; name: string }) => [d.name.trim().toLowerCase(), d.id]));
  const { data: existing } = await db.from("tariffs").select("id, code").eq("hospital_id", c.hospitalId);
  const idByCode = new Map((existing ?? []).map((x: { id: string; code: string }) => [x.code.toUpperCase(), x.id]));
  const errors: { row: number; message: string }[] = [];
  const seen = new Set<string>();
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  rows.forEach((r: Record<string, unknown>, i: number) => {
    const t = cleanTariff(r);
    if (t.error) { errors.push({ row: i + 2, message: t.error }); return; }
    const code = t.row!.code as string;
    if (seen.has(code)) { errors.push({ row: i + 2, message: `Code ${code} appears twice in the file.` }); return; }
    seen.add(code);
    let departmentId: string | null = null;
    const dn = String(r.department ?? "").trim().toLowerCase();
    if (dn) { departmentId = deptByName.get(dn) ?? null; if (!departmentId) { errors.push({ row: i + 2, message: `Department "${r.department}" not found.` }); return; } }
    const row = { ...t.row, department_id: departmentId, updated_at: now };
    const id = idByCode.get(code);
    if (id) updates.push({ id, ...row }); else inserts.push({ ...row, hospital_id: c.hospitalId, created_by: c.userId });
  });
  if (b.dry_run || errors.length) return json({ ok: true, data: { inserted: 0, updated: 0, would_insert: inserts.length, would_update: updates.length, errors, saved: false } });
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await db.from("tariffs").insert(inserts.slice(i, i + 500));
    if (error) return fail("server", "Import stopped part-way. Please re-run it; already-saved rows will be updated.", 500);
  }
  for (const u of updates) {
    const { id, ...rest } = u;
    await db.from("tariffs").update(rest).eq("id", id as string).eq("hospital_id", c.hospitalId);
  }
  await audit(db, req, c, "import", "tariff", null, null, { inserted: inserts.length, updated: updates.length });
  return json({ ok: true, data: { inserted: inserts.length, updated: updates.length, errors: [], saved: true } });
});
