// Paste into Supabase → Edge Functions → new function "record-payment". Turn "Enforce JWT Verification" OFF.
// Cashier/admin. Body: { invoice_id, amount, tendered? }. Never accepts more than the balance; returns the payment + updated bill.
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
// ---- cash helpers (MediCore; identical in every cash function) -------------
const CASH_ROLES = ["super_admin", "admin", "cashier"];
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (v: unknown) => { const n = r2(Number(v)); return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? n : null; };
// Surveillance groups by ICD-10 code prefix (mirrored in src/lib/surveillance.ts).
const SURV_GROUPS: Record<string, string[]> = {
  dengue: ["A90", "A91", "A97"], malaria: ["B50", "B51", "B52", "B53", "B54"], typhoid: ["A01"],
  hepatitis: ["B15", "B16", "B17", "B18", "B19"], tb: ["A15", "A16", "A17", "A18", "A19"], measles: ["B05"], heatstroke: ["T67"],
};
const AGE_GROUPS = ["0-4", "5-14", "15-24", "25-44", "45-64", "65+", "unknown"];
const survGroup = (code: string) => { const c = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); for (const [g, ps] of Object.entries(SURV_GROUPS)) if (ps.some((p) => c.startsWith(p))) return g; return null; };
const survDay = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600e3).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
function ageGroup(dob: string | null, at: string) {
  if (!dob) return "unknown";
  const a = (Date.parse(at) - Date.parse(dob)) / (365.25 * 864e5);
  return a < 5 ? "0-4" : a < 15 ? "5-14" : a < 25 ? "15-24" : a < 45 ? "25-44" : a < 65 ? "45-64" : "65+";
}
// One case = one patient + disease per visit (several codes of one disease on a visit count once).
// Surge: a 7-day week (ending on `to`, stepping back) is ≥50% above the average of the 4 weeks before it (and ≥3 cases).
// deno-lint-ignore no-explicit-any
async function surveillance(db: any, hospitalId: string, from: string, to: string, groups: string[]) {
  const start = addDays(from, -28); // extra 4 weeks for the baseline
  const prefixes = groups.flatMap((g) => SURV_GROUPS[g] ?? []);
  const or = prefixes.map((p) => `icd10_code.ilike.${p}%`).join(",");
  const rows: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from("visit_diagnoses").select("icd10_code, created_at, visit_id, visits!inner(patient_id, created_at, patients(district, dob))")
      .eq("hospital_id", hospitalId).or(or).gte("created_at", `${start}T00:00:00+05:00`).lte("created_at", `${to}T23:59:59.999+05:00`).range(off, off + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const seen = new Set<string>();
  const cases: { g: string; day: string; district: string; age: string }[] = [];
  for (const r of rows) {
    const g = survGroup(r.icd10_code); if (!g || !groups.includes(g)) continue;
    const k = `${r.visit_id}|${g}`; if (seen.has(k)) continue; seen.add(k);
    const at = r.visits?.created_at ?? r.created_at;
    cases.push({ g, day: survDay(at), district: (r.visits?.patients?.district ?? "").trim() || "Unknown", age: ageGroup(r.visits?.patients?.dob ?? null, at) });
  }
  const days: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const inRange = cases.filter((x) => x.day >= from && x.day <= to);
  const daily = days.map((d) => { const o: Record<string, unknown> = { day: d }; for (const g of groups) o[g] = 0; return o; });
  const di = new Map(days.map((d, i) => [d, i]));
  const districts: Record<string, Record<string, number>> = {};
  const ages: Record<string, Record<string, number>> = {};
  const totals: Record<string, number> = {};
  for (const x of inRange) {
    (daily[di.get(x.day)!] as any)[x.g]++;
    (districts[x.district] ??= {})[x.g] = (districts[x.district][x.g] ?? 0) + 1;
    (ages[x.age] ??= {})[x.g] = (ages[x.age][x.g] ?? 0) + 1;
    totals[x.g] = (totals[x.g] ?? 0) + 1;
  }
  const count = (g: string, a: string, b: string) => cases.filter((x) => x.g === g && x.day >= a && x.day <= b).length;
  const weeks: Record<string, { end: string; count: number; baseline: number; surge: boolean }[]> = {};
  const surges: { group: string; week_end: string; count: number; baseline: number; pct: number }[] = [];
  for (const g of groups) {
    weeks[g] = [];
    for (let end = to; end >= addDays(from, 6); end = addDays(end, -7)) {
      const n = count(g, addDays(end, -6), end);
      let base = 0; for (let w = 1; w <= 4; w++) base += count(g, addDays(end, -6 - 7 * w), addDays(end, -7 * w));
      base = Math.round((base / 4) * 10) / 10;
      const surge = n >= 3 && n >= base * 1.5 && n > base;
      weeks[g].unshift({ end, count: n, baseline: base, surge });
      if (surge) surges.push({ group: g, week_end: end, count: n, baseline: base, pct: base > 0 ? Math.round(((n - base) / base) * 100) : 100 });
    }
  }
  return {
    from, to, groups, daily, totals, weeks, surges,
    districts: Object.entries(districts).map(([district, v]) => ({ district, ...v, total: Object.values(v).reduce((s, n) => s + n, 0) })).sort((a, b) => b.total - a.total),
    ages: AGE_GROUPS.filter((a) => ages[a]).map((age) => ({ age, ...ages[age], total: Object.values(ages[age]).reduce((s, n) => s + n, 0) })),
  };
}
// Admin: disease surveillance counts by day, district and age group, with surge flags.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c, b } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!has(c, ["super_admin", "admin"])) return fail("forbidden", "Only an admin can view surveillance.", 403);
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const today = survDay(new Date().toISOString());
  const to = re.test(String(b.to)) ? String(b.to) : today;
  const from = re.test(String(b.from)) ? String(b.from) : addDays(to, -55);
  if (from > to || Date.parse(to) - Date.parse(from) > 366 * 864e5) return fail("invalid", "Choose a range of up to one year.");
  const groups = Array.isArray(b.groups) && b.groups.length ? b.groups.map(String).filter((g: string) => SURV_GROUPS[g]) : Object.keys(SURV_GROUPS);
  try { return json({ ok: true, data: await surveillance(db, c.hospitalId, from, to, groups) }); }
  catch { return fail("server", "Could not build the report.", 500); }
});
