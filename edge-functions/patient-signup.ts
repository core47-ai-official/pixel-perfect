// Paste into Supabase → Edge Functions → new function "patient-signup". Turn "Enforce JWT Verification" OFF.
// Public. Body: { full_name, email? | phone?, password, hospital_id? } — creates auth user, profile and patient role + patient_accounts row.
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

const PHONE = /^(\+92|0)3\d{9}$/;
const normPhone = (p: string) => "+92" + p.replace(/^(\+92|0)/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method", "POST only.", 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const b = await req.json().catch(() => ({}));
  const full_name = String(b.full_name ?? "").trim().slice(0, 120);
  const email = String(b.email ?? "").trim().toLowerCase();
  const phoneRaw = String(b.phone ?? "").replace(/[\s-]/g, "");
  const password = String(b.password ?? "");
  if (full_name.length < 2) return fail("invalid", "Enter your full name.");
  if (!email && !phoneRaw) return fail("invalid", "Enter a phone number or email.");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("invalid", "Enter a valid email.");
  if (!email && !PHONE.test(phoneRaw)) return fail("invalid", "Enter a valid mobile number, e.g. 03001234567.");
  if (password.length < 8) return fail("invalid", "Password must be at least 8 characters.");
  const phone = email ? null : normPhone(phoneRaw);

  // Hospital: explicit id, else the only active hospital.
  let hospitalId = typeof b.hospital_id === "string" ? b.hospital_id : null;
  if (!hospitalId) {
    const { data: hs } = await db.from("hospitals").select("id").eq("is_active", true).limit(2);
    if (hs?.length !== 1) return fail("hospital", "Please sign up from your hospital's link.");
    hospitalId = hs[0].id;
  } else {
    const { data: h } = await db.from("hospitals").select("id").eq("id", hospitalId).eq("is_active", true).maybeSingle();
    if (!h) return fail("hospital", "Hospital not found.");
  }

  const { data: created, error } = await db.auth.admin.createUser({
    ...(email ? { email, email_confirm: true } : { phone: phone!, phone_confirm: true }),
    password, user_metadata: { full_name, portal: "patient" },
  });
  if (error || !created?.user) {
    const taken = /already|registered|exists/i.test(error?.message ?? "");
    return fail(taken ? "taken" : "signup_failed", taken ? "An account already exists. Please sign in." : "Could not create the account. Please try again.");
  }
  const uid = created.user.id;
  const steps = [
    await db.from("profiles").insert({ id: uid, hospital_id: hospitalId, full_name, email: email || null, phone, must_change_password: false }),
    await db.from("user_roles").insert({ user_id: uid, hospital_id: hospitalId, role: "patient" }),
    await db.from("patient_accounts").insert({ user_id: uid, hospital_id: hospitalId }),
  ];
  if (steps.some((s) => s.error)) {
    // Roll back so the person can try again with the same phone/email.
    await db.from("patient_accounts").delete().eq("user_id", uid);
    await db.from("user_roles").delete().eq("user_id", uid);
    await db.from("profiles").delete().eq("id", uid);
    await db.auth.admin.deleteUser(uid);
    return fail("signup_failed", "Could not create the account. Please try again.", 500);
  }
  return json({ ok: true, data: { user_id: uid, login: email || phone } });
});
