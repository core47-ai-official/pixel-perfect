// Paste into Supabase → Edge Functions → new function "search-icd10". Turn "Enforce JWT Verification" OFF.
// Clinical staff: search ICD-10 by code prefix or words; returns top 20.
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

const ROLES = ["doctor", "dept_head", "nurse", "er_officer", "ot_coordinator", "super_admin", "admin"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => ROLES.includes(r))) return fail("forbidden", "Not allowed.", 403);
  const b = await req.json().catch(() => ({}));
  const q = String(b.q ?? "").trim().replace(/[%_,()]/g, " ").slice(0, 80);
  if (q.length < 2) return json({ ok: true, data: [] });
  const codeLike = /^[A-Za-z]\d/.test(q);
  const rows = new Map<string, { code: string; description: string; chapter: string | null }>();
  if (codeLike) {
    const { data } = await db.from("icd10_codes").select("code, description, chapter")
      .ilike("code", q.toUpperCase().replace(/\s/g, "") + "%").order("code").limit(20);
    for (const r of data ?? []) rows.set(r.code, r);
  }
  if (rows.size < 20) {
    // Every word must appear in the description.
    let qb = db.from("icd10_codes").select("code, description, chapter");
    for (const w of q.split(/\s+/).filter(Boolean).slice(0, 5)) qb = qb.ilike("description", `%${w}%`);
    const { data } = await qb.order("code").limit(40);
    for (const r of data ?? []) if (rows.size < 20) rows.set(r.code, r);
  }
  return json({ ok: true, data: [...rows.values()] });
});
