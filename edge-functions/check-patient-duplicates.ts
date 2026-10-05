// Paste into Supabase → Edge Functions → new function "check-patient-duplicates". Turn "Enforce JWT Verification" OFF.
// Input: { cnic?, phone?, full_name?, dob?, exclude_id? } → { matches: [{ id, mrn, full_name, ..., reasons: ["cnic"|"phone"|"name_dob"] }] }
// Any hospital staff (not patients).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
const COLS = "id, mrn, full_name, father_or_husband_name, dob, gender, phone, cnic, district";

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
  const hospitalId = prof.hospital_id;
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId).eq("hospital_id", hospitalId);
  if (!(roles ?? []).some((r) => r.role !== "patient")) return fail("forbidden", "Staff only.", 403);

  const b = await req.json().catch(() => ({}));
  const cnic = String(b.cnic ?? "").replace(/\D/g, "");
  const phone = String(b.phone ?? "").replace(/\D/g, "").replace(/^92/, "").replace(/^0/, "");
  const name = String(b.full_name ?? "").trim().toLowerCase();
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(String(b.dob ?? "")) ? String(b.dob) : null;
  const exclude = b.exclude_id ? String(b.exclude_id) : null;

  const found = new Map<string, Record<string, unknown> & { reasons: string[] }>();
  const add = (rows: Record<string, unknown>[] | null, reason: string) => {
    for (const r of rows ?? []) {
      if (r.id === exclude) continue;
      const cur = found.get(r.id as string) ?? { ...r, reasons: [] };
      if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
      found.set(r.id as string, cur);
    }
  };
  const base = () => db.from("patients").select(COLS).eq("hospital_id", hospitalId).is("merged_into", null).limit(10);

  if (cnic.length === 13) {
    const formatted = `${cnic.slice(0, 5)}-${cnic.slice(5, 12)}-${cnic.slice(12)}`;
    const { data } = await base().in("cnic", [formatted, cnic]);
    add(data, "cnic");
  }
  if (phone.length === 10) {
    const { data } = await base().in("phone", [`+92 ${phone.slice(0, 3)} ${phone.slice(3)}`, `0${phone}`, `+92${phone}`]);
    add(data, "phone");
  }
  if (name.length >= 2 && dob) {
    const { data } = await base().ilike("full_name", name).eq("dob", dob);
    add(data, "name_dob");
  }

  const order = { cnic: 0, name_dob: 1, phone: 2 } as Record<string, number>;
  const matches = [...found.values()].sort((a, b) =>
    Math.min(...a.reasons.map((r) => order[r])) - Math.min(...b.reasons.map((r) => order[r])));
  return json({ ok: true, data: { matches } });
});
