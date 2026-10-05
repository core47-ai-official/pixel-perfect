// Paste into Supabase → Edge Functions → new function "import-icd10". Turn "Enforce JWT Verification" OFF.
// super_admin: upload the WHO ICD-10 list as CSV text. Columns: code,description[,chapter] (header row optional).
// Upserts by code, so it can be re-run safely. Body: { csv: "<file text>" }.
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

function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); out.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); out.push(row); }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const c = await getCaller(req, db);
  if ("error" in c) return c.error;
  if (c.impersonatedBy || !c.roles.includes("super_admin")) return fail("forbidden", "Only a super admin can import ICD-10.", 403);
  const b = await req.json().catch(() => ({}));
  const csv = String(b.csv ?? "");
  if (!csv || csv.length > 15_000_000) return fail("invalid", "Upload a CSV file under 15 MB.");
  const seen = new Map<string, { code: string; description: string; chapter: string | null; updated_at: string }>();
  let skipped = 0; const now = new Date().toISOString();
  for (const r of parseCsv(csv)) {
    const code = (r[0] ?? "").trim().toUpperCase();
    const description = (r[1] ?? "").trim();
    if (!/^[A-Z][0-9][0-9A-Z](\.?[0-9A-Z]{1,4})?$/.test(code) || !description) { skipped++; continue; }
    // Normalise "A010" → "A01.0"
    const norm = code.includes(".") || code.length === 3 ? code : code.slice(0, 3) + "." + code.slice(3);
    seen.set(norm, { code: norm, description: description.slice(0, 500), chapter: (r[2] ?? "").trim() || null, updated_at: now });
  }
  const rows = [...seen.values()];
  if (!rows.length) return fail("invalid", "No valid rows found. Expected columns: code, description, chapter.");
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from("icd10_codes").upsert(rows.slice(i, i + 1000), { onConflict: "code" });
    if (error) return fail("server", `Import stopped at row ${i}.`, 500);
  }
  await db.from("audit_logs").insert({ hospital_id: c.hospitalId, user_id: c.userId, action: "import_icd10", resource: "icd10_codes", after: { imported: rows.length, skipped } });
  return json({ ok: true, data: { imported: rows.length, skipped } });
});
