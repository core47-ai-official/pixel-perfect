// Supabase → Edge Functions → "get-company-settings". JWT verification OFF.
// Returns company settings for the caller's hospital. Non-admins get only public fields.
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

const TABS = ["general","branding","localization","security","opd","appointments","billing","pharmacy","lab","wards","emergency","printing","notifications","patient_portal","health_tracker","dashboards"];
const PUBLIC: Record<string, string[]> = {
  general: ["hospital_name","address","city","province","website"],
  branding: ["logo","mono_logo","favicon","accent_color"],
  localization: ["default_language","default_print_language","date_format","week_start"],
  security: ["session_timeout_minutes"],
  opd: ["opd_start","opd_end"],
  wards: ["visiting_hours"],
  patient_portal: ["portal_enabled"],
};
const ASSETS = ["logo","mono_logo","favicon","signature","stamp"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(db, req);
  if ("error" in c) return c.error;
  const canEdit = c.roles.includes("super_admin") || c.roles.includes("admin");

  const { data: row } = await db.from("company_settings").select("*").eq("hospital_id", c.hospitalId).maybeSingle();
  const settings: Record<string, Record<string, unknown>> = {};
  for (const tab of TABS) {
    const v = (row?.[tab] ?? {}) as Record<string, unknown>;
    if (canEdit) settings[tab] = v;
    else if (PUBLIC[tab]) settings[tab] = Object.fromEntries(Object.entries(v).filter(([k]) => PUBLIC[tab].includes(k)));
  }

  const asset_urls: Record<string, string> = {};
  const all = { ...(settings.branding ?? {}), ...(settings.printing ?? {}) } as Record<string, unknown>;
  for (const k of ASSETS) {
    const p = all[k];
    if (typeof p === "string" && p) {
      const { data } = await db.storage.from("branding").createSignedUrl(p, 3600);
      if (data?.signedUrl) asset_urls[k] = data.signedUrl;
    }
  }

  const [{ data: contacts }, { data: holidays }] = await Promise.all([
    db.from("company_contacts").select("id, type, label, value, is_primary").eq("hospital_id", c.hospitalId).order("created_at"),
    db.from("holidays").select("id, holiday_date, name, is_recurring").eq("hospital_id", c.hospitalId).order("holiday_date"),
  ]);
  return json({ ok: true, data: { settings, asset_urls, contacts: contacts ?? [], holidays: holidays ?? [], can_edit: canEdit } });
});
