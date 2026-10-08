// Supabase → Edge Functions → "update-company-settings". JWT verification OFF.
// Input: { tab, values } | { tab: "contacts", contacts } | { tab: "holidays", holidays }. Admin / super_admin. Audit-logged.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);

// deno-lint-ignore no-explicit-any
async function getCaller(db: any, req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return { error: fail("unauthorized", "Please sign in again.", 401) };
  let userId = u.user.id as string;
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
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId).eq("hospital_id", prof.hospital_id);
  return { userId, impersonatedBy, hospitalId: prof.hospital_id as string, roles: (roles ?? []).map((r: { role: string }) => r.role) };
}

const TABS = ["general","branding","localization","security","opd","appointments","billing","pharmacy","lab","wards","emergency","printing","notifications","patient_portal"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(db, req);
  if ("error" in c) return c.error;
  if (!c.roles.includes("super_admin") && !c.roles.includes("admin")) return fail("forbidden", "Only admins can change company settings.", 403);
  const body = await req.json().catch(() => ({}));
  const tab = String(body.tab ?? "");
  const audit = (before: unknown, after: unknown) => db.from("audit_logs").insert({
    hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy, action: "update",
    resource: "company_settings", resource_id: null, before: { [tab]: before }, after: { [tab]: after }, ip: req.headers.get("x-forwarded-for"),
  });

  if (tab === "contacts" || tab === "holidays") {
    const rows = Array.isArray(body[tab]) ? body[tab] : null;
    if (!rows || rows.length > 200) return fail("validation", "Invalid list.");
    const table = tab === "contacts" ? "company_contacts" : "holidays";
    // deno-lint-ignore no-explicit-any
    const clean = rows.map((r: any) => tab === "contacts"
      ? { hospital_id: c.hospitalId, type: r.type === "phone" ? "phone" : "email", label: String(r.label ?? "").trim().slice(0, 80), value: String(r.value ?? "").trim().slice(0, 200), is_primary: !!r.is_primary, created_by: c.userId }
      : { hospital_id: c.hospitalId, holiday_date: String(r.holiday_date ?? ""), name: String(r.name ?? "").trim().slice(0, 100), is_recurring: !!r.is_recurring, created_by: c.userId });
    // deno-lint-ignore no-explicit-any
    if (clean.some((r: any) => tab === "contacts" ? !r.value : (!/^\d{4}-\d{2}-\d{2}$/.test(r.holiday_date) || !r.name)))
      return fail("validation", "Please fill every row.");
    const { data: before } = await db.from(table).select("*").eq("hospital_id", c.hospitalId);
    await db.from(table).delete().eq("hospital_id", c.hospitalId);
    const { error } = clean.length ? await db.from(table).insert(clean) : { error: null };
    if (error) {
      // deno-lint-ignore no-explicit-any
      if (before?.length) await db.from(table).insert(before.map(({ ...r }: any) => r));
      return fail("db", error.message);
    }
    await audit(before, clean);
    return json({ ok: true, data: { saved: clean.length } });
  }

  if (!TABS.includes(tab)) return fail("validation", "Unknown settings section.");
  const values = body.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) return fail("validation", "Invalid values.");
  for (const v of Object.values(values)) {
    if (!["string","number","boolean"].includes(typeof v) || (typeof v === "string" && v.length > 5000))
      return fail("validation", "Invalid value.");
  }
  if (tab === "general" && "is_live" in values && !c.roles.includes("super_admin")) return fail("forbidden", "Only a super admin can mark the hospital live.", 403);

  const { data: row } = await db.from("company_settings").select("id, " + tab).eq("hospital_id", c.hospitalId).maybeSingle();
  const before = (row?.[tab] ?? {}) as Record<string, unknown>;
  const after = { ...before, ...values };
  const { error } = row
    ? await db.from("company_settings").update({ [tab]: after, updated_at: new Date().toISOString() }).eq("id", row.id)
    : await db.from("company_settings").insert({ hospital_id: c.hospitalId, [tab]: after, created_by: c.userId });
  if (error) return fail("db", error.message);
  await audit(before, after);
  return json({ ok: true, data: { tab, values: after } });
});
