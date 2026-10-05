// Paste into Supabase → Edge Functions → new function "search-patients". Turn "Enforce JWT Verification" OFF.
// Input: { q }  (min 2 characters). Any hospital staff (not patients).
// Searches MRN, CNIC, phone and name with ILIKE; returns top 10: id, mrn, full_name, dob, age, gender, phone, cnic.
// Digit-only queries also match CNIC/phone with or without dashes/spaces.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);

function age(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return fail("unauthorized", "Please sign in again.", 401);
  let userId = u.user.id;
  const impId = req.headers.get("x-impersonation-session");
  if (impId) {
    const { data: s } = await db.from("impersonation_sessions").select("*").eq("id", impId).maybeSingle();
    if (!s || s.super_admin_id !== userId || s.ended_at || new Date(s.expires_at) < new Date())
      return fail("forbidden", "Acting session is not active.", 403);
    userId = s.target_user_id;
  }
  const { data: prof } = await db.from("profiles").select("hospital_id, is_active").eq("id", userId).maybeSingle();
  if (!prof?.is_active) return fail("forbidden", "Account is not active.", 403);
  const { data: rolesRows } = await db.from("user_roles").select("role").eq("user_id", userId).eq("hospital_id", prof.hospital_id);
  if (!(rolesRows ?? []).some((r) => r.role !== "patient")) return fail("forbidden", "Staff only.", 403);

  const body = await req.json().catch(() => ({}));
  // Strip characters that would break the PostgREST or() filter.
  const q = String(body.q ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 60);
  if (q.length < 2) return json({ ok: true, data: [] });

  const like = `%${q}%`;
  const filters = [`mrn.ilike.${like}`, `full_name.ilike.${like}`, `cnic.ilike.${like}`, `phone.ilike.${like}`, `b_form.ilike.${like}`];
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4 && digits.length === q.replace(/[\s-]/g, "").length) {
    const loose = `%${digits.split("").join("%")}%`; // matches 35202-1234567-1 when typed 352021234
    filters.push(`cnic.ilike.${loose}`, `phone.ilike.${loose}`, `mrn.ilike.%${digits}%`);
  }

  const { data, error } = await db.from("patients")
    .select("id, mrn, full_name, dob, gender, phone, cnic, print_language")
    .eq("hospital_id", prof.hospital_id).is("merged_into", null)
    .or(filters.join(","))
    .order("updated_at", { ascending: false }).limit(10);
  if (error) return fail("server_error", "Search failed.", 500);

  return json({ ok: true, data: (data ?? []).map((p) => ({ ...p, age: age(p.dob) })) });
});
