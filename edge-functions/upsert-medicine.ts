// Paste into Supabase → Edge Functions → new function "upsert-medicine". Turn "Enforce JWT Verification" OFF.
// Admin / pharmacist: create or edit one formulary medicine. Body: medicine fields, plus id to edit.
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

const EDIT_ROLES = ["admin", "pharmacist", "super_admin"];
const FORMS = ["tablet","capsule","syrup","suspension","injection","infusion","drops","cream","ointment","inhaler","suppository","sachet","other"];
const ROUTES = ["oral","iv","im","sc","topical","inhalation","ophthalmic","otic","nasal","rectal","vaginal","sublingual","other"];
const txt = (v: unknown, n = 200) => { const s = String(v ?? "").trim().slice(0, n); return s || null; };
const groups = (v: unknown) => [...new Set((Array.isArray(v) ? v : String(v ?? "").split(/[;,]/)).map((g) => String(g).trim().toLowerCase()).filter(Boolean))].slice(0, 20);

/** Validates one medicine; returns [row, null] or [null, problem]. */
// deno-lint-ignore no-explicit-any
function cleanMedicine(b: any): [Record<string, unknown> | null, string | null] {
  const generic_name = txt(b.generic_name);
  if (!generic_name) return [null, "generic"];
  const form = String(b.form ?? "tablet").trim().toLowerCase() || "tablet";
  if (!FORMS.includes(form)) return [null, "form"];
  const route = String(b.route ?? "oral").trim().toLowerCase() || "oral";
  if (!ROUTES.includes(route)) return [null, "route"];
  const price = Number(String(b.unit_price ?? "0").replace(/,/g, "") || 0);
  if (!Number.isFinite(price) || price < 0 || price > 10_000_000) return [null, "price"];
  return [{ generic_name, brand_name: txt(b.brand_name), strength: txt(b.strength, 60), form, route,
    unit_price: Math.round(price * 100) / 100, drap_reg_no: txt(b.drap_reg_no, 60),
    is_active: b.is_active === undefined ? true : b.is_active === true || b.is_active === "true",
    interaction_group: groups(b.interaction_group) }, null];
}
const sameKey = (m: any) => [m.generic_name, m.brand_name ?? "", m.strength ?? ""].map((s: string) => s.toLowerCase()).join("|") + "|" + m.form;

// deno-lint-ignore no-explicit-any
async function audit(db: DB, req: Request, c: any, action: string, resource: string, id: string | null, before: unknown, after: unknown) {
  await db.from("audit_logs").insert({ hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action,
    resource, resource_id: id, before, after, ip: req.headers.get("x-forwarded-for") });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => EDIT_ROLES.includes(r))) return fail("forbidden", "Only admin or pharmacy can edit the formulary.", 403);
  const b = await req.json().catch(() => ({}));
  const [row, problem] = cleanMedicine(b);
  if (!row) return fail("invalid", `Invalid medicine: ${problem}.`);
  const now = new Date().toISOString();
  if (b.id) {
    const { data: before } = await db.from("medicines").select("*").eq("id", String(b.id)).eq("hospital_id", c.hospitalId).maybeSingle();
    if (!before) return fail("not_found", "Medicine not found.", 404);
    const { data, error } = await db.from("medicines").update({ ...row, updated_at: now }).eq("id", before.id).select().single();
    if (error) return fail(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? "This medicine already exists." : "Could not save.", error.code === "23505" ? 409 : 500);
    await audit(db, req, c, "update", "medicine", before.id, before, data);
    return json({ ok: true, data });
  }
  const { data, error } = await db.from("medicines").insert({ ...row, hospital_id: c.hospitalId, created_by: c.userId }).select().single();
  if (error) return fail(error.code === "23505" ? "duplicate" : "server", error.code === "23505" ? "This medicine already exists." : "Could not save.", error.code === "23505" ? 409 : 500);
  await audit(db, req, c, "create", "medicine", data.id, null, data);
  return json({ ok: true, data });
});
