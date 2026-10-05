// Paste into Supabase → Edge Functions → new function "enter-lab-result". Turn "Enforce JWT Verification" OFF.
// lab_tech or admin: saves result values for a collected order and computes flags from the reference ranges.
// Body: { order_id, values: [{ parameter, value, unit?, reference_range?, flag? }], notes? }
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
const FLAGS = ["normal", "low", "high", "critical"];
const RANK: Record<string, number> = { normal: 0, low: 1, high: 1, critical: 2 };
// Ranges look like "3.5-5.1", "<200", ">40", "<= 5"; anything else is not parsed.
function parseRange(s: string | null | undefined): { low?: number; high?: number } {
  const t = String(s ?? "").replace(/,/g, "").trim();
  let m = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)/i);
  if (m) return { low: Number(m[1]), high: Number(m[2]) };
  m = t.match(/^<=?\s*(-?\d+(?:\.\d+)?)/); if (m) return { high: Number(m[1]) };
  m = t.match(/^>=?\s*(-?\d+(?:\.\d+)?)/); if (m) return { low: Number(m[1]) };
  return {};
}
// deno-lint-ignore no-explicit-any
function computeFlag(value: string, range: string | null, def: any, manual: string | undefined) {
  const n = Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || String(value).trim() === "") return FLAGS.includes(String(manual)) ? String(manual) : "normal";
  const cl = def?.critical_low, ch = def?.critical_high;
  if ((typeof cl === "number" && n <= cl) || (typeof ch === "number" && n >= ch)) return "critical";
  const r = parseRange(range);
  if (r.low !== undefined && n < r.low) return "low";
  if (r.high !== undefined && n > r.high) return "high";
  return "normal";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => LAB_ROLES.includes(r))) return fail("forbidden", "Only lab staff can enter results.", 403);
  const b = await req.json().catch(() => ({}));
  const { data: o } = await db.from("orders").select("*, lab_tests(code, name, reference_range, parameters)").eq("id", String(b.order_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!o) return fail("not_found", "Order not found.", 404);
  if (!["collected", "resulted"].includes(o.status)) return fail("invalid", "Results can be entered only after the sample is collected and before verification.", 409);
  const raw = Array.isArray(b.values) ? b.values.slice(0, 60) : [];
  // deno-lint-ignore no-explicit-any
  const defs: any[] = Array.isArray(o.lab_tests?.parameters) ? o.lab_tests.parameters : [];
  // deno-lint-ignore no-explicit-any
  const rows = raw.map((v: any, i: number) => {
    const parameter = String(v?.parameter ?? "").trim().slice(0, 120);
    const value = String(v?.value ?? "").trim().slice(0, 500);
    const def = defs.find((d) => String(d?.name ?? "").toLowerCase() === parameter.toLowerCase());
    const reference_range = (String(v?.reference_range ?? "").trim() || def?.range || (defs.length ? "" : o.lab_tests?.reference_range) || "").slice(0, 200) || null;
    const unit = (String(v?.unit ?? "").trim() || def?.unit || "").slice(0, 40) || null;
    return { hospital_id: c.hospitalId, order_id: o.id, parameter, value, unit, reference_range, sort: i, created_by: c.userId,
      flag: computeFlag(value, reference_range, def, v?.flag) };
  }).filter((r: { parameter: string; value: string }) => r.parameter && r.value);
  if (!rows.length) return fail("invalid", "Enter at least one value.");
  const worst = rows.reduce((w: string, r: { flag: string }) => (RANK[r.flag] > RANK[w] ? r.flag : w), "normal");
  const result = rows.map((r: { parameter: string; value: string; unit: string | null; flag: string }) =>
    `${r.parameter}: ${r.value}${r.unit ? " " + r.unit : ""}${r.flag !== "normal" ? " (" + r.flag.toUpperCase() + ")" : ""}`).join("\n");
  const now = new Date().toISOString();
  const { data: upd, error } = await db.from("orders").update({ status: "resulted", result, result_flag: worst, has_critical: worst === "critical",
    notes: typeof b.notes === "string" ? b.notes.slice(0, 1000) : o.notes, resulted_at: now, resulted_by: c.userId, updated_at: now })
    .eq("id", o.id).eq("status", o.status).select().maybeSingle();
  if (error || !upd) return fail("invalid", "The order changed meanwhile. Refresh and try again.", 409);
  await db.from("lab_result_values").delete().eq("order_id", o.id);
  const { data: vals, error: e2 } = await db.from("lab_result_values").insert(rows).select();
  if (e2) return fail("server", "Couldn't save the values. Try again.", 500);
  await audit(db, req, c, "enter_result", "order", o.id, o, { ...upd, values: vals });
  return json({ ok: true, data: { order: upd, values: vals } });
});
