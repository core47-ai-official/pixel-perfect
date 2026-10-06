// Paste into Supabase → Edge Functions → new function "save-prescription". Turn "Enforce JWT Verification" OFF.
// Visit's doctor: saves the prescription for a visit (replaces items). Safety is re-checked here;
// if any warnings exist, body.acknowledged must be true and the acknowledgement is stored.
// Body: { visit_id, notes, acknowledged, items: [{ medicine_id, dose, frequency, route, duration_days, instructions_en, instructions_ur, quantity }] }
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

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const int = (v: unknown, max: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  const b = await req.json().catch(() => ({}));
  const { data: doc } = await db.from("doctors").select("id").eq("user_id", c.userId).eq("hospital_id", c.hospitalId).maybeSingle();
  const { data: v } = await db.from("visits").select("id, doctor_id, patient_id, status").eq("id", String(b.visit_id ?? "")).eq("hospital_id", c.hospitalId).maybeSingle();
  if (!v) return fail("not_found", "Visit not found.", 404);
  if (!doc || v.doctor_id !== doc.id) return fail("forbidden", "Only the visit's doctor can prescribe.", 403);
  if (v.status !== "draft") return fail("locked", "This consultation is completed.", 409);
  const items = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
  if (!items.length) return fail("invalid", "Add at least one medicine.");
  const ids = items.map((i: any) => String(i.medicine_id ?? ""));
  const { data: meds } = await db.from("medicines").select("id, generic_name, brand_name, strength, form, is_active").eq("hospital_id", c.hospitalId).in("id", ids);
  const medMap = new Map((meds ?? []).map((m: any) => [m.id, m]));
  for (const id of ids) { const m: any = medMap.get(id); if (!m) return fail("invalid", "Unknown medicine."); if (!m.is_active) return fail("invalid", `${m.generic_name} is no longer in the formulary.`); }

  const warnings = await checkSafety(db, c.hospitalId, v.patient_id, ids);
  if (warnings.length && b.acknowledged !== true)
    return json({ ok: false, error: { code: "needs_acknowledgement", message: "Please review the warnings and tick the box.", warnings } }, 409);

  const now = new Date().toISOString();
  const { data: before } = await db.from("prescriptions").select("*").eq("visit_id", v.id).maybeSingle();
  const header = {
    hospital_id: c.hospitalId, visit_id: v.id, patient_id: v.patient_id, doctor_id: doc.id, status: "active",
    notes: clip(b.notes, 2000), warnings, warnings_acknowledged: warnings.length > 0,
    acknowledged_at: warnings.length ? now : null, acknowledged_by: warnings.length ? c.userId : null, updated_at: now,
  };
  const { data: rx, error } = before
    ? await db.from("prescriptions").update(header).eq("id", before.id).select().single()
    : await db.from("prescriptions").insert({ ...header, created_by: c.userId }).select().single();
  if (error || !rx) return fail("server", "Could not save prescription.", 500);
  await db.from("prescription_items").delete().eq("prescription_id", rx.id);
  const rows = items.map((i: any, idx: number) => {
    const m: any = medMap.get(String(i.medicine_id));
    return {
      hospital_id: c.hospitalId, prescription_id: rx.id, medicine_id: m.id, sort_order: idx, created_by: c.userId,
      medicine_name: [m.generic_name, m.brand_name ? `(${m.brand_name})` : "", m.strength ?? ""].filter(Boolean).join(" "),
      dose: clip(i.dose, 60), frequency: clip(i.frequency, 60), route: clip(i.route || "oral", 30),
      duration_days: int(i.duration_days, 365), instructions_en: clip(i.instructions_en, 300), instructions_ur: clip(i.instructions_ur, 300),
      quantity: int(i.quantity, 10000) ?? 0,
    };
  });
  const { data: saved, error: e2 } = await db.from("prescription_items").insert(rows).select();
  if (e2) return fail("server", "Could not save prescription items.", 500);
  await db.from("audit_logs").insert({ hospital_id: c.hospitalId, user_id: c.userId, impersonated_by: c.impersonatedBy,
    action: before ? "update" : "create", resource: "prescription", resource_id: rx.id, before, after: { ...rx, items: saved },
    ip: req.headers.get("x-forwarded-for") });
  // Inpatients: rebuild the ward medication schedule (separate function; failures don't block saving).
  try {
    const h: Record<string, string> = { "Content-Type": "application/json", Authorization: req.headers.get("Authorization") ?? "" };
    const imp = req.headers.get("x-impersonation-session"); if (imp) h["x-impersonation-session"] = imp;
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-mar-schedule`, { method: "POST", headers: h, body: JSON.stringify({ prescription_id: rx.id }) });
  } catch (_) { /* schedule can be rebuilt from the ward board */ }
  // Linked patients: put the course into their health tracker (separate function; failures don't block saving).
  try {
    const h: Record<string, string> = { "Content-Type": "application/json", Authorization: req.headers.get("Authorization") ?? "" };
    const imp = req.headers.get("x-impersonation-session"); if (imp) h["x-impersonation-session"] = imp;
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-prescriptions-to-tracker`, { method: "POST", headers: h, body: JSON.stringify({ prescription_id: rx.id }) });
  } catch (_) { /* re-saving the prescription syncs again */ }
  return json({ ok: true, data: { prescription: rx, items: saved } });
});
