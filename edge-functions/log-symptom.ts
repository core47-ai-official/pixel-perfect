// Paste into Supabase → Edge Functions → new function "log-symptom". Turn "Enforce JWT Verification" OFF.
// Patient only. Body: { symptom, severity 1-10, started_at?, ended_at?, triggers[], related?, notes?, attachment_url? (path from upload-symptom-attachment) }.
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
// ---- symptom rules (MediCore; identical in log-symptom and update-symptom, mirrored in src/lib/symptoms.ts) ----
const TRIGGERS = ["food", "stress", "exercise", "weather", "medicine"];
// deno-lint-ignore no-explicit-any
function checkSymptom(b: any, acctId: string): { error: string } | { row: Record<string, unknown> } {
  const symptom = String(b.symptom ?? "").trim().slice(0, 120);
  if (symptom.length < 2) return { error: "Choose or type a symptom." };
  const severity = Number(b.severity);
  if (!Number.isInteger(severity) || severity < 1 || severity > 10) return { error: "Severity must be from 1 to 10." };
  const start = b.started_at ? new Date(String(b.started_at)) : new Date();
  if (isNaN(start.getTime())) return { error: "Enter a valid start time." };
  if (start.getTime() > Date.now() + 5 * 60_000) return { error: "The start time can't be in the future." };
  let end: Date | null = null;
  if (b.ended_at) {
    end = new Date(String(b.ended_at));
    if (isNaN(end.getTime())) return { error: "Enter a valid end time." };
    if (end < start) return { error: "The end time must be after the start time." };
    if (end.getTime() > Date.now() + 5 * 60_000) return { error: "The end time can't be in the future." };
  }
  const triggers = [...new Set((Array.isArray(b.triggers) ? b.triggers : []).map(String))].filter((x) => TRIGGERS.includes(x as string));
  let attachment: string | null = null;
  if (b.attachment_url) {
    attachment = String(b.attachment_url);
    if (!attachment.startsWith(acctId + "/") || attachment.includes("..")) return { error: "That attachment doesn't belong to you." };
  }
  return { row: { symptom, severity, started_at: start.toISOString(), ended_at: end?.toISOString() ?? null, triggers,
    related: String(b.related ?? "").trim().slice(0, 200) || null, notes: String(b.notes ?? "").trim().slice(0, 1000) || null, attachment_url: attachment } };
}
async function myAccount(db: DB, c: { userId: string; roles: string[]; impersonatedBy: string | null }) {
  if (!c.roles.includes("patient") || c.impersonatedBy) return null;
  const { data } = await db.from("patient_accounts").select("id, patient_id").eq("user_id", c.userId).maybeSingle();
  return data as { id: string; patient_id: string | null } | null;
}
// ---- end symptom rules ----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  const acct = await myAccount(db, c);
  if (!acct) return fail("forbidden", "Only patients can log their own symptoms.", 403);
  const chk = checkSymptom(b, acct.id);
  if ("error" in chk) return fail("invalid", chk.error);
  const { data, error } = await db.from("symptom_logs").insert({ ...chk.row, patient_account_id: acct.id, patient_id: acct.patient_id }).select().single();
  if (error) return fail("server", "Couldn't save the symptom.", 500);
  return json({ ok: true, data });
});
