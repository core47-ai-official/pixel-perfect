// Paste into Supabase → Edge Functions → new function "check-prescription-safety". Turn "Enforce JWT Verification" OFF.
// Clinical staff / pharmacy: body { patient_id, medicine_ids: [] } → warnings (allergy, duplicate generic, interaction).
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

const RX_READ = ["doctor", "dept_head", "nurse", "er_officer", "pharmacist"];
type Warning = { kind: "allergy" | "duplicate" | "interaction"; severity: "major" | "moderate" | "minor" | "contraindicated"; medicine_ids: string[]; message: string };
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Allergy matches, duplicate generics and group-to-group interactions between the listed medicines. */
async function checkSafety(db: DB, hospitalId: string, patientId: string, medicineIds: string[]): Promise<Warning[]> {
  const ids = [...new Set(medicineIds.map(String))].slice(0, 50);
  if (!ids.length) return [];
  const [{ data: meds }, { data: pt }, { data: ix }] = await Promise.all([
    db.from("medicines").select("id, generic_name, brand_name, interaction_group").eq("hospital_id", hospitalId).in("id", ids),
    db.from("patients").select("allergies").eq("id", patientId).eq("hospital_id", hospitalId).maybeSingle(),
    db.from("drug_interactions").select("group_a, group_b, severity, note").eq("hospital_id", hospitalId),
  ]);
  const list = (meds ?? []) as { id: string; generic_name: string; brand_name: string | null; interaction_group: string[] }[];
  const label = (m: { generic_name: string; brand_name: string | null }) => m.brand_name ? `${m.generic_name} (${m.brand_name})` : m.generic_name;
  const out: Warning[] = [];
  // 1. Allergies: allergy text matches the generic, brand or an interaction group (either way round).
  for (const a of (pt?.allergies ?? []).map(norm).filter((x: string) => x.length >= 3)) {
    for (const m of list) {
      const terms = [norm(m.generic_name), norm(m.brand_name), ...m.interaction_group.map(norm)].filter(Boolean);
      if (terms.some((t) => t.includes(a) || a.includes(t))) out.push({ kind: "allergy", severity: "contraindicated", medicine_ids: [m.id], message: `Patient is allergic to "${a}": ${label(m)}` });
    }
  }
  // 2. Duplicate generics.
  const byGeneric = new Map<string, typeof list>();
  for (const m of list) byGeneric.set(norm(m.generic_name), [...(byGeneric.get(norm(m.generic_name)) ?? []), m]);
  for (const [g, ms] of byGeneric) if (ms.length > 1) out.push({ kind: "duplicate", severity: "moderate", medicine_ids: ms.map((m) => m.id), message: `Same generic prescribed twice: ${g}` });
  // 3. Interactions between groups of two different medicines.
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    for (const x of ix ?? []) {
      const hit = (a.interaction_group.includes(x.group_a) && b.interaction_group.includes(x.group_b)) ||
                  (a.interaction_group.includes(x.group_b) && b.interaction_group.includes(x.group_a));
      if (hit) out.push({ kind: "interaction", severity: x.severity, medicine_ids: [a.id, b.id], message: `${label(a)} + ${label(b)}: ${x.note || `${x.group_a} ↔ ${x.group_b}`}` });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (!c.roles.some((r) => RX_READ.includes(r))) return fail("forbidden", "Not allowed.", 403);
  const b = await req.json().catch(() => ({}));
  const warnings = await checkSafety(db, c.hospitalId, String(b.patient_id ?? ""), Array.isArray(b.medicine_ids) ? b.medicine_ids : []);
  return json({ ok: true, data: warnings });
});
