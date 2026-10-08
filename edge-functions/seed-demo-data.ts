// Paste into Supabase → Edge Functions → new function "seed-demo-data". Turn "Enforce JWT Verification" OFF.
// super_admin only; refuses when company settings mark the hospital live (general.is_live) or demo data is already loaded.
// Creates departments, doctors, staff/patient logins (passwords returned once), patients, appointments, visits, bills, wards and tracker readings; every row is recorded in demo_rows.
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
// ---- demo data helpers (identical in seed-demo-data and clear-demo-data) ----
// Every demo row id is recorded in demo_rows (table_name, row_id); demo auth users under table_name "auth.users".
// Clearing deletes children first, also removing rows staff later added against demo patients/users, so nothing real is touched.
const chunk = <T,>(a: T[], n = 150) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
async function demoIds(db: DB, h: string, table: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("demo_rows").select("row_id").eq("hospital_id", h).eq("table_name", table).range(from, from + 999);
    out.push(...(data ?? []).map((r: { row_id: string }) => r.row_id));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function delIn(db: DB, table: string, col: string, ids: string[], errs: string[]) {
  for (const part of chunk(ids)) {
    const { error } = await db.from(table).delete().in(col, part);
    if (error && !/does not exist|schema cache/i.test(error.message)) errs.push(`${table}.${col}: ${error.message}`);
  }
}
async function clearDemo(db: DB, h: string): Promise<{ removed: number; errors: string[] }> {
  const errs: string[] = [];
  const ids: Record<string, string[]> = {};
  for (const t of ["patients", "patient_accounts", "visits", "appointments", "admissions", "invoices", "prescriptions", "orders", "doctors", "departments", "wards", "beds",
    "lab_tests", "medicines", "tariffs", "counters", "cashier_shifts", "doctor_schedules", "auth.users", "measurements", "tracker_profiles", "connections"])
    ids[t] = await demoIds(db, h, t);
  const P = ids.patients, PA = ids.patient_accounts, U = ids["auth.users"];
  const removed = Object.values(ids).reduce((s, a) => s + a.length, 0);
  // tracker
  for (const t of ["measurements", "symptom_logs", "dose_events", "medication_schedules", "tracker_conditions", "tracker_profiles", "health_report_shares", "connections"])
    await delIn(db, t, "patient_account_id", PA, errs);
  await delIn(db, "health_report_shares", "patient_id", P, errs);
  await delIn(db, "feedback", "patient_id", P, errs);
  // money
  await delIn(db, "payments", "patient_id", P, errs);
  await delIn(db, "deposits", "patient_id", P, errs);
  await delIn(db, "installment_plans", "patient_id", P, errs);
  await delIn(db, "unpaid_followups", "patient_id", P, errs);
  await delIn(db, "approvals", "patient_id", P, errs);
  await delIn(db, "welfare_transactions", "patient_id", P, errs);
  const invIds = [...ids.invoices];
  for (const part of chunk(P)) { const { data } = await db.from("invoices").select("id").in("patient_id", part); invIds.push(...(data ?? []).map((r: { id: string }) => r.id)); }
  await delIn(db, "invoice_lines", "invoice_id", invIds, errs);
  await delIn(db, "invoices", "id", invIds, errs);
  // clinical
  await delIn(db, "dispensations", "patient_id", P, errs);
  const rxIds = [...ids.prescriptions];
  for (const part of chunk(P)) { const { data } = await db.from("prescriptions").select("id").in("patient_id", part); rxIds.push(...(data ?? []).map((r: { id: string }) => r.id)); }
  await delIn(db, "med_administrations", "patient_id", P, errs);
  await delIn(db, "prescription_items", "prescription_id", rxIds, errs);
  await delIn(db, "prescriptions", "id", rxIds, errs);
  const ordIds = [...ids.orders];
  for (const part of chunk(P)) { const { data } = await db.from("orders").select("id").in("patient_id", part); ordIds.push(...(data ?? []).map((r: { id: string }) => r.id)); }
  await delIn(db, "lab_result_values", "order_id", ordIds, errs);
  await delIn(db, "orders", "id", ordIds, errs);
  await delIn(db, "blood_requests", "patient_id", P, errs);
  await delIn(db, "referrals", "patient_id", P, errs);
  await delIn(db, "discharge_summaries", "patient_id", P, errs);
  await delIn(db, "vitals", "patient_id", P, errs);
  const visIds = [...ids.visits];
  for (const part of chunk(P)) { const { data } = await db.from("visits").select("id").in("patient_id", part); visIds.push(...(data ?? []).map((r: { id: string }) => r.id)); }
  await delIn(db, "visit_diagnoses", "visit_id", visIds, errs);
  await delIn(db, "visit_addenda", "visit_id", visIds, errs);
  await delIn(db, "visits", "id", visIds, errs);
  await delIn(db, "ot_bookings", "patient_id", P, errs);
  await delIn(db, "emergency_cases", "patient_id", P, errs);
  await delIn(db, "bed_requests", "patient_id", P, errs);
  for (const part of chunk(P)) {
    const { data } = await db.from("admissions").select("id").in("patient_id", part);
    const a = (data ?? []).map((r: { id: string }) => r.id);
    if (a.length) await db.from("beds").update({ status: "free", current_admission_id: null }).in("current_admission_id", a);
  }
  await delIn(db, "admissions", "patient_id", P, errs);
  await delIn(db, "appointments", "patient_id", P, errs);
  await delIn(db, "patient_link_codes", "patient_id", P, errs);
  await delIn(db, "patient_entitlements", "patient_id", P, errs);
  await delIn(db, "patient_accounts", "id", PA, errs);
  await delIn(db, "patients", "id", P, errs);
  // set-up data
  await delIn(db, "cashier_shifts", "id", ids.cashier_shifts, errs);
  await delIn(db, "beds", "id", ids.beds, errs);
  await delIn(db, "wards", "id", ids.wards, errs);
  await delIn(db, "doctor_schedules", "doctor_id", ids.doctors, errs);
  await delIn(db, "doctor_leaves", "doctor_id", ids.doctors, errs);
  for (const part of chunk(ids.doctors)) await db.from("departments").update({ head_doctor_id: null }).in("head_doctor_id", part);
  await delIn(db, "connections", "doctor_id", ids.doctors, errs);
  await delIn(db, "doctors", "id", ids.doctors, errs);
  await delIn(db, "departments", "id", ids.departments, errs);
  await delIn(db, "lab_tests", "id", ids.lab_tests, errs);
  await delIn(db, "medicines", "id", ids.medicines, errs);
  await delIn(db, "tariffs", "id", ids.tariffs, errs);
  await delIn(db, "counters", "id", ids.counters, errs);
  // users
  for (const t of ["roster_shifts", "notifications", "notification_preferences", "push_subscriptions", "dashboard_layouts", "audit_logs", "error_logs"])
    await delIn(db, t, "user_id", U, errs);
  await delIn(db, "roster_shifts", "staff_id", U, errs);
  await delIn(db, "user_roles", "user_id", U, errs);
  await delIn(db, "profiles", "id", U, errs);
  for (const u of U) { const { error } = await db.auth.admin.deleteUser(u); if (error && !/not found/i.test(error.message)) errs.push(`user ${u}: ${error.message}`); }
  if (!errs.length) await db.from("demo_rows").delete().eq("hospital_id", h);
  return { removed, errors: errs.slice(0, 20) };
}
// ---- end demo data helpers ----
// ---- seed data ----
const MALE = ["Muhammad Ali", "Ahmed Raza", "Usman Tariq", "Bilal Hussain", "Hamza Iqbal", "Imran Khan", "Zeeshan Haider", "Faisal Mehmood", "Waqas Ahmed", "Asad Ullah",
  "Kamran Akmal", "Shoaib Akhtar", "Danish Ali", "Junaid Anwar", "Noman Ijaz", "Saad Rafiq", "Adnan Siddiqui", "Hassan Javed", "Tariq Jamil", "Rizwan Saeed",
  "Ghulam Abbas", "Abdul Rehman", "Arslan Qadir", "Sohail Anjum", "Fahad Mustafa", "Yasir Nawaz", "Umer Farooq", "Shahid Mahmood", "Naveed Akhtar", "Jawad Hassan"];
const FEMALE = ["Fatima Bibi", "Ayesha Siddiqa", "Zainab Noor", "Maryam Aslam", "Khadija Bano", "Sana Javed", "Hira Mani", "Amna Ilyas", "Iqra Aziz", "Saima Parveen",
  "Nazia Batool", "Rukhsana Begum", "Sadia Imam", "Mehwish Hayat", "Aqsa Riaz", "Rabia Anum", "Shazia Kausar", "Nimra Khalid", "Bushra Ansari", "Farzana Yasmin",
  "Kiran Shahzadi", "Samina Ahmad", "Uzma Gillani", "Asma Jahangir", "Tahira Syed", "Naila Jaffri", "Sumaira Akram", "Lubna Tariq", "Mahnoor Baloch", "Anam Zahid"];
const FATHERS = ["Muhammad Akram", "Ghulam Rasool", "Bashir Ahmed", "Javed Iqbal", "Shaukat Ali", "Abdul Majeed", "Muhammad Aslam", "Allah Ditta", "Nazir Hussain", "Riaz Ahmed", "Manzoor Elahi", "Khalid Mehmood"];
// [district, province, CNIC prefix]
const DISTRICTS: [string, string, string][] = [["Lahore", "punjab", "35202"], ["Karachi Central", "sindh", "42101"], ["Islamabad", "ict", "61101"], ["Rawalpindi", "punjab", "37405"],
  ["Faisalabad", "punjab", "33100"], ["Multan", "punjab", "36302"], ["Peshawar", "kpk", "17301"], ["Quetta", "balochistan", "54400"], ["Gujranwala", "punjab", "34101"],
  ["Hyderabad", "sindh", "41303"], ["Sialkot", "punjab", "34603"], ["Sargodha", "punjab", "38403"], ["Bahawalpur", "punjab", "31202"], ["Mardan", "kpk", "16101"], ["Sukkur", "sindh", "45504"]];
const DEPTS = [
  { name: "General Medicine", type: "clinical", docs: [["Dr. Ayesha Khan", "female", "Internal Medicine"], ["Dr. Usman Raza", "male", "Internal Medicine"]] },
  { name: "Paediatrics", type: "clinical", docs: [["Dr. Sana Malik", "female", "Paediatrics"], ["Dr. Hamza Qureshi", "male", "Paediatrics"]] },
  { name: "Gynaecology & Obstetrics", type: "clinical", docs: [["Dr. Farah Siddiqui", "female", "Gynaecology"], ["Dr. Nida Yousaf", "female", "Obstetrics"]] },
  { name: "General Surgery", type: "surgical", docs: [["Dr. Bilal Ahmed", "male", "General Surgery"], ["Dr. Kashif Mirza", "male", "General Surgery"]] },
];
const ROLES: [string, string][] = [["admin", "Nadia Hussain"], ["dept_head", "Dr. Tariq Aziz"], ["nurse", "Rabia Noor"], ["er_officer", "Dr. Owais Malik"],
  ["ot_coordinator", "Shabana Kiran"], ["receptionist", "Kamran Ali"], ["pharmacist", "Adeel Butt"], ["lab_tech", "Sajid Mehmood"], ["cashier", "Imran Shah"]];
const DX: [string, string, string][] = [["J06.9", "Acute upper respiratory infection, unspecified", "J"], ["A09", "Infectious gastroenteritis and colitis", "A"],
  ["E11.9", "Type 2 diabetes mellitus without complications", "E"], ["I10", "Essential (primary) hypertension", "I"], ["A01.0", "Typhoid fever", "A"],
  ["M54.5", "Low back pain", "M"], ["R50.9", "Fever, unspecified", "R"], ["A90", "Dengue fever", "A"], ["J18.9", "Pneumonia, unspecified", "J"], ["K29.7", "Gastritis, unspecified", "K"]];
const COMPLAINTS = ["Fever and body aches for 3 days", "Cough and sore throat", "Loose motions since yesterday", "Headache and dizziness", "Burning in the stomach",
  "Follow-up of sugar", "Blood pressure check", "Back pain", "High fever with chills", "Pain in lower abdomen", "Child with fever and cough", "Routine antenatal check"];
const LABS: [string, string, string, number][] = [["CBC", "Complete blood count", "blood", 800], ["LFT", "Liver function tests", "blood", 1500], ["RFT", "Renal function tests", "blood", 1200],
  ["HBA1C", "HbA1c", "blood", 1800], ["LIPID", "Lipid profile", "blood", 2000], ["UA", "Urine routine examination", "urine", 400], ["TYPHI", "Typhidot", "blood", 900], ["DENGUE", "Dengue NS1 antigen", "blood", 2200]];
const MEDS: [string, string, string, string, number][] = [["Paracetamol", "Panadol", "500 mg", "tablet", 3], ["Amoxicillin", "Amoxil", "500 mg", "capsule", 18], ["Omeprazole", "Risek", "20 mg", "capsule", 15],
  ["Metformin", "Glucophage", "500 mg", "tablet", 8], ["Amlodipine", "Norvasc", "5 mg", "tablet", 12], ["Ibuprofen", "Brufen", "400 mg", "tablet", 6], ["Cetirizine", "Zyrtec", "10 mg", "tablet", 10],
  ["Azithromycin", "Azomax", "250 mg", "capsule", 45], ["ORS", "Peditral", "sachet", "sachet", 25], ["Ciprofloxacin", "Ciproxin", "500 mg", "tablet", 22]];
const RX = [[0, "1 tablet", "TDS", 5, "After meals", "کھانے کے بعد", 15], [1, "1 capsule", "TDS", 7, "After meals", "کھانے کے بعد", 21], [2, "1 capsule", "OD", 14, "Before breakfast", "ناشتے سے پہلے", 14],
  [3, "1 tablet", "BD", 30, "With meals", "کھانے کے ساتھ", 60], [4, "1 tablet", "OD", 30, "In the morning", "صبح", 30], [6, "1 tablet", "OD", 5, "At night", "رات کو", 5], [7, "1 capsule", "OD", 3, "Before meals", "کھانے سے پہلے", 3]] as const;

let seed = 20261007;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pw = () => { const a = new Uint8Array(9); crypto.getRandomValues(a); return Array.from(a, (x) => "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 55]).join("") + "#7"; };
const pkDate = (offset: number) => { const d = new Date(Date.now() + 5 * 3600e3 + offset * 86400e3); return d.toISOString().slice(0, 10); };
const at = (date: string, hm: string) => new Date(`${date}T${hm}:00+05:00`).toISOString();
const addMin = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60000).toISOString();
const weekday = (date: string) => new Date(`${date}T12:00:00+05:00`).getUTCDay();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { db, c } = await BOOT(req);
  if ("error" in c) return c.error;
  if (!c.roles.includes("super_admin") || c.impersonatedBy) return fail("forbidden", "Only the super admin can add demo data.", 403);
  const h = c.hospitalId;
  const { data: cs } = await db.from("company_settings").select("general").eq("hospital_id", h).maybeSingle();
  if (cs?.general?.is_live === true) return fail("hospital_live", "This hospital is marked as live in Company settings, so demo data can't be added.", 409);
  const { count: already } = await db.from("demo_rows").select("id", { count: "exact", head: true }).eq("hospital_id", h);
  if (already) return fail("already_seeded", "Demo data is already loaded. Clear it first to load it again.", 409);

  const track = async (table: string, ids: string[]) => {
    for (const part of chunk(ids, 500)) { const { error } = await db.from("demo_rows").insert(part.map((row_id) => ({ hospital_id: h, table_name: table, row_id }))); if (error) throw new Error(`track ${table}: ${error.message}`); }
  };
  // deno-lint-ignore no-explicit-any
  const ins = async (table: string, rows: any[], cols = "id"): Promise<any[]> => {
    const out = [];
    for (const part of chunk(rows, 300)) {
      const { data, error } = await db.from(table).insert(part).select(cols);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...data);
    }
    await track(table, out.map((r: { id: string }) => r.id));
    return out;
  };
  const tag = Math.random().toString(36).slice(2, 6);
  const accounts: { name: string; role: string; email: string; password: string }[] = [];
  const mkUser = async (name: string, role: string, slug: string, extra: Record<string, unknown> = {}) => {
    const email = `${slug}.${tag}@demo.medicore.pk`, password = pw();
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
    if (error || !data?.user) throw new Error(`user ${email}: ${error?.message}`);
    const id = data.user.id;
    await track("auth.users", [id]);
    const p = await db.from("profiles").upsert({ id, hospital_id: h, full_name: name, email, phone: `0300-${int(1000000, 9999999)}`, is_active: true, must_change_password: false, created_by: c.userId });
    if (p.error) throw new Error(`profile: ${p.error.message}`);
    const r = await db.from("user_roles").insert({ user_id: id, hospital_id: h, role, created_by: c.userId, ...extra });
    if (r.error) throw new Error(`role: ${r.error.message}`);
    accounts.push({ name, role, email, password });
    return id;
  };

  try {
    const counts: Record<string, number> = {};
    // departments (reuse same-named real ones)
    const { data: exDeps } = await db.from("departments").select("id, name").eq("hospital_id", h);
    const depIds: string[] = [];
    for (const d of DEPTS) {
      const ex = (exDeps ?? []).find((x: { name: string }) => x.name.toLowerCase() === d.name.toLowerCase());
      depIds.push(ex ? ex.id : (await ins("departments", [{ hospital_id: h, name: d.name, type: d.type, created_by: c.userId }]))[0].id);
    }
    counts.departments = 4;
    // doctors + schedules
    const doctors: { id: string; user: string; dep: string; name: string; fee: number }[] = [];
    let k = 0;
    for (let di = 0; di < DEPTS.length; di++) for (const [name, gender, spec] of DEPTS[di].docs) {
      const u = await mkUser(name, "doctor", `doctor${++k}`, { department_id: depIds[di] });
      const code = (name.replace(/[^A-Z]/g, "").slice(1, 4) + tag.toUpperCase()).slice(0, 6).padEnd(6, "X");
      const fee = 1500 + (k % 4) * 500;
      const [d] = await ins("doctors", [{ hospital_id: h, user_id: u, department_id: depIds[di], specialty: spec, gender, languages: ["en", "ur"], consultation_fee: fee, followup_fee: Math.round(fee / 2),
        pmdc_no: `${40000 + k * 1117}-P`, status: pick(["available", "in_opd", "in_opd", "on_round"]), verified: true, verification_status: "approved", doctor_code: code, created_by: c.userId }]);
      doctors.push({ id: d.id, user: u, dep: depIds[di], name, fee });
    }
    for (let i = 0; i < doctors.length; i += 2) await db.from("departments").update({ head_doctor_id: doctors[i].id }).eq("id", doctors[i].dep).is("head_doctor_id", null);
    await ins("doctor_schedules", doctors.flatMap((d, i) => [1, 2, 3, 4, 5, 6].map((wd) => ({ hospital_id: h, doctor_id: d.id, weekday: wd,
      start_time: i % 2 ? "14:00" : "09:00", end_time: i % 2 ? "19:00" : "14:00", slot_minutes: 15, max_patients: 20, room: `OPD-${i + 1}`, created_by: c.userId }))));
    counts.doctors = doctors.length;
    // one user per other role
    const staff: Record<string, string> = {};
    for (const [role, name] of ROLES) staff[role] = await mkUser(name, role, role.replace("_", ""), role === "dept_head" ? { department_id: depIds[0] } : role === "lab_tech" ? { can_verify_lab: true } : {});
    const recep = staff.receptionist, cashier = staff.cashier, nurse = staff.nurse;
    // catalogue: reuse by code / name
    const { data: exLabs } = await db.from("lab_tests").select("id, code, price").eq("hospital_id", h);
    const labs: { id: string; price: number }[] = [];
    for (const [code, name, sample, price] of LABS) {
      const ex = (exLabs ?? []).find((x: { code: string }) => x.code.toUpperCase() === code);
      labs.push(ex ? { id: ex.id, price: Number(ex.price) } : { id: (await ins("lab_tests", [{ hospital_id: h, code, name, category: "lab", sample_type: sample, price, turnaround_hours: 6, created_by: c.userId }]))[0].id, price });
    }
    const { data: exMeds } = await db.from("medicines").select("id, generic_name, brand_name, strength").eq("hospital_id", h);
    const meds: { id: string; label: string }[] = [];
    for (const [g, b, s, f, p] of MEDS) {
      const ex = (exMeds ?? []).find((x: { generic_name: string; brand_name: string; strength: string }) => x.generic_name.toLowerCase() === g.toLowerCase() && (x.brand_name ?? "").toLowerCase() === b.toLowerCase() && (x.strength ?? "") === s);
      meds.push({ id: ex ? ex.id : (await ins("medicines", [{ hospital_id: h, generic_name: g, brand_name: b, strength: s, form: f, route: "oral", unit_price: p, reorder_level: 50, created_by: c.userId }]))[0].id, label: `${g} ${s}` });
    }
    const { data: exTar } = await db.from("tariffs").select("code").eq("hospital_id", h);
    const tarNew = [["CON-OPD", "OPD consultation", "consultation", 1500], ["RM-GEN", "General ward bed (per day)", "room", 2500], ["RM-PVT", "Private room (per day)", "room", 8000]]
      .filter(([code]) => !(exTar ?? []).some((x: { code: string }) => x.code.toUpperCase() === code));
    if (tarNew.length) await ins("tariffs", tarNew.map(([code, name, category, price]) => ({ hospital_id: h, code, name, category, price, room_class: code === "RM-GEN" ? "general" : code === "RM-PVT" ? "private" : null, created_by: c.userId })));
    await db.from("icd10_codes").upsert(DX.map(([code, description, chapter]) => ({ code, description, chapter })), { onConflict: "code", ignoreDuplicates: true });

    // 200 patients
    const yr = pkDate(0).slice(0, 4);
    const pats = await ins("patients", Array.from({ length: 200 }, (_, i) => {
      const male = rnd() < 0.5, name = pick(male ? MALE : FEMALE), [district, province, pre] = pick(DISTRICTS);
      const age = rnd() < 0.18 ? int(1, 14) : int(18, 78);
      const dob = new Date(Date.now() - (age * 365 + int(0, 364)) * 86400e3).toISOString().slice(0, 10);
      const last = male ? pick([1, 3, 5, 7, 9]) : pick([2, 4, 6, 8, 0]);
      return { hospital_id: h, mrn: `MRN-DEMO-${String(i + 1).padStart(5, "0")}`, cnic: age >= 18 ? `${pre}-${int(1000000, 9999999)}-${last}` : null,
        full_name: name, father_or_husband_name: pick(FATHERS), dob, gender: male ? "male" : "female", phone: `03${pick(["00", "01", "21", "33", "45", "12"])}-${int(1000000, 9999999)}`,
        province, district, address: `House ${int(1, 400)}, Street ${int(1, 30)}, ${district}`, blood_group: pick(["A+", "B+", "O+", "AB+", "O-", "B-", "A-"]),
        allergies: rnd() < 0.1 ? ["Penicillin"] : [], chronic_conditions: rnd() < 0.15 ? ["Diabetes"] : rnd() < 0.15 ? ["Hypertension"] : [],
        print_language: rnd() < 0.4 ? "ur" : "en", created_by: recep, created_at: new Date(Date.now() - int(15, 400) * 86400e3).toISOString() };
    }), "id, full_name, gender");
    counts.patients = pats.length;

    // cashier shift (today)
    const [shift] = await ins("cashier_shifts", [{ hospital_id: h, cashier_id: cashier, cashier_name: "Imran Shah", opened_at: at(pkDate(0), "08:00"), opening_cash: 5000, status: "open", created_by: cashier }]);

    // appointments over 2 weeks: 10 days back, today, 3 days ahead (Mon–Sat)
    // deno-lint-ignore no-explicit-any
    const appts: any[] = []; const meta: { pat: number; doc: number; date: string; status: string; offset: number }[] = [];
    const tokens: Record<string, number> = {};
    for (let off = -10; off <= 3; off++) {
      const date = pkDate(off); if (weekday(date) === 0) continue;
      for (let di = 0; di < doctors.length; di++) {
        const n = off < 0 ? int(5, 8) : off === 0 ? 7 : int(2, 4);
        for (let s = 0; s < n; s++) {
          const pi = int(0, 199); const start = at(date, di % 2 ? "14:00" : "09:00"); const slot = addMin(start, s * 15);
          const status = off < 0 ? (rnd() < 0.85 ? "done" : rnd() < 0.5 ? "no_show" : "cancelled")
            : off === 0 ? (["done", "done", "in_consultation", "waiting", "waiting", "booked", "booked"][s] ?? "booked") : "booked";
          const key = `${di}:${date}`; tokens[key] = (tokens[key] ?? 0) + 1;
          appts.push({ hospital_id: h, patient_id: pats[pi].id, doctor_id: doctors[di].id, department_id: doctors[di].dep, slot_start: slot, slot_end: addMin(slot, 15), token_no: tokens[key],
            type: rnd() < 0.25 ? "follow_up" : "new", channel: pick(["reception", "reception", "phone", "portal"]), status, fee: doctors[di].fee, created_by: recep,
            cancel_reason: status === "cancelled" ? "Patient asked to cancel" : null,
            checked_in_at: ["done", "in_consultation", "waiting"].includes(status) ? addMin(slot, -20) : null,
            called_at: ["done", "in_consultation"].includes(status) ? slot : null, completed_at: status === "done" ? addMin(slot, 12) : null,
            created_at: new Date(new Date(slot).getTime() - int(1, 5) * 86400e3).toISOString() });
          meta.push({ pat: pi, doc: di, date, status, offset: off });
        }
      }
    }
    const apIds = await ins("appointments", appts);
    counts.appointments = apIds.length;
    const todayKeys = Object.entries(tokens).filter(([k2]) => k2.endsWith(pkDate(0)));
    if (todayKeys.length) await ins("counters", todayKeys.map(([k2, n]) => ({ hospital_id: h, key: `token:${doctors[Number(k2.split(":")[0])].id}:${pkDate(0)}`, prefix: "", next_value: n + 1, reset_rule: "never" })));

    // visits for completed appointments
    const doneIdx = meta.map((m, i) => ({ ...m, i })).filter((m) => m.status === "done");
    const visits = await ins("visits", doneIdx.map((m) => ({ hospital_id: h, patient_id: pats[m.pat].id, doctor_id: doctors[m.doc].id, appointment_id: apIds[m.i].id, type: "opd",
      chief_complaint: pick(COMPLAINTS), history: "Symptoms started gradually. No previous admissions.", examination: "Alert and oriented. Chest clear. Abdomen soft.",
      plan: "Medicines as prescribed. Review if not better.", status: "completed", completed_at: appts[m.i].completed_at, created_by: doctors[m.doc].user, created_at: appts[m.i].slot_start })));
    counts.visits = visits.length;
    await db.from("visit_diagnoses").insert(visits.map((v: { id: string }, i: number) => { const d = pick(DX); return { hospital_id: h, visit_id: v.id, icd10_code: d[0], description: d[1], is_primary: true, created_by: doctors[doneIdx[i].doc].user }; }));
    await db.from("vitals").insert(visits.map((v: { id: string }, i: number) => ({ hospital_id: h, patient_id: pats[doneIdx[i].pat].id, visit_id: v.id, bp_sys: int(105, 160), bp_dia: int(65, 100), pulse: int(64, 104),
      temp_c: Math.round((36.5 + rnd() * 2.3) * 10) / 10, spo2: int(94, 99), weight_kg: int(45, 95), height_cm: int(150, 182), rr: int(14, 22), recorded_by: nurse, recorded_at: appts[doneIdx[i].i].checked_in_at })));
    // prescriptions (~70%) and orders (~35%)
    const rxVisits = visits.map((v: { id: string }, i: number) => ({ v, m: doneIdx[i] })).filter(() => rnd() < 0.7);
    const rxs = await ins("prescriptions", rxVisits.map(({ v, m }: { v: { id: string }; m: typeof doneIdx[0] }) => ({ hospital_id: h, visit_id: v.id, patient_id: pats[m.pat].id, doctor_id: doctors[m.doc].id,
      status: "active", notes: "Plenty of fluids and rest.", warnings: [], warnings_acknowledged: false, created_by: doctors[m.doc].user, created_at: appts[m.i].completed_at })));
    await db.from("prescription_items").insert(rxs.flatMap((rx: { id: string }, i: number) => {
      const n = int(1, 3); const used = new Set<number>(); const out = [];
      for (let j = 0; j < n; j++) { const r = pick(RX); if (used.has(r[0])) continue; used.add(r[0]);
        out.push({ hospital_id: h, prescription_id: rx.id, medicine_id: meds[r[0]].id, medicine_name: meds[r[0]].label, dose: r[1], frequency: r[2], route: "oral", duration_days: r[3],
          instructions_en: r[4], instructions_ur: r[5], quantity: r[6], sort_order: j + 1, created_by: doctors[rxVisits[i].m.doc].user }); }
      return out;
    }));
    counts.prescriptions = rxs.length;
    const ordVisits = visits.map((v: { id: string }, i: number) => ({ v, m: doneIdx[i] })).filter(() => rnd() < 0.35);
    const orders = await ins("orders", ordVisits.map(({ v, m }: { v: { id: string }; m: typeof doneIdx[0] }) => {
      const lab = pick(labs); const pending = m.offset === 0 || rnd() < 0.15; const st = pending ? pick(["ordered", "collected"]) : "verified";
      return { hospital_id: h, visit_id: v.id, patient_id: pats[m.pat].id, doctor_id: doctors[m.doc].id, test_id: lab.id, priority: rnd() < 0.15 ? "urgent" : "routine", status: st, price: lab.price,
        result: st === "verified" ? "Within reference range" : null, result_flag: st === "verified" ? (rnd() < 0.2 ? "high" : "normal") : null,
        resulted_at: st === "verified" ? addMin(appts[m.i].completed_at, 300) : null, verified_at: st === "verified" ? addMin(appts[m.i].completed_at, 360) : null,
        verified_by: st === "verified" ? staff.lab_tech : null, collected_at: st !== "ordered" ? addMin(appts[m.i].completed_at, 30) : null, collected_by: st !== "ordered" ? staff.lab_tech : null,
        created_by: doctors[m.doc].user, created_at: appts[m.i].completed_at };
    }), "id, visit_id, price");
    counts.orders = orders.length;

    // OPD invoices: paid / partly paid / unpaid (one open bill per patient)
    let invN = 1, rcpN = 1; const openFor = new Set<string>();
    // deno-lint-ignore no-explicit-any
    const invRows: any[] = [], lineRows: Record<string, unknown>[][] = [], payRows: (null | { amount: number; at: string; today: boolean })[] = [];
    for (let i = 0; i < visits.length; i++) {
      const m = doneIdx[i], pid = pats[m.pat].id, fee = doctors[m.doc].fee;
      const vOrders = orders.filter((o: { visit_id: string }) => o.visit_id === visits[i].id);
      const total = fee + vOrders.reduce((s: number, o: { price: number }) => s + Number(o.price), 0);
      let status = rnd() < 0.65 ? "paid" : rnd() < 0.5 ? "partly_paid" : "open";
      if (status !== "paid" && openFor.has(pid)) status = "paid";
      if (status !== "paid") openFor.add(pid);
      const paid = status === "paid" ? total : status === "partly_paid" ? Math.round(total / 2 / 100) * 100 : 0;
      const when = appts[m.i].completed_at;
      invRows.push({ hospital_id: h, patient_id: pid, visit_id: visits[i].id, invoice_no: `INV-DEMO-${yr}-${String(invN++).padStart(5, "0")}`, payer_type: "self", total, discount: 0, paid, balance: total - paid, status, created_by: recep, created_at: when });
      lineRows.push([{ description: "OPD consultation", qty: 1, rate: fee, amount: fee, source_type: "visit", source_id: visits[i].id },
        ...vOrders.map((o: { id: string; price: number }) => ({ description: "Lab test", qty: 1, rate: Number(o.price), amount: Number(o.price), source_type: "order", source_id: o.id }))]);
      payRows.push(paid ? { amount: paid, at: addMin(when, 5), today: m.offset === 0 } : null);
    }
    const invs = await ins("invoices", invRows);
    await db.from("invoice_lines").insert(invs.flatMap((inv: { id: string }, i: number) => lineRows[i].map((l) => ({ hospital_id: h, invoice_id: inv.id, posted_by: recep, created_at: invRows[i].created_at, ...l }))));
    const pays = invs.map((inv: { id: string }, i: number) => payRows[i] && ({ hospital_id: h, invoice_id: inv.id, patient_id: invRows[i].patient_id, receipt_no: `RCP-DEMO-${yr}-${String(rcpN++).padStart(5, "0")}`,
      kind: "payment", amount: payRows[i]!.amount, payment_mode: "cash", tendered: payRows[i]!.amount, received_by: cashier, shift_id: payRows[i]!.today ? shift.id : null, created_at: payRows[i]!.at })).filter(Boolean);
    const { error: pe } = await db.from("payments").insert(pays); if (pe) throw new Error(`payments: ${pe.message}`);
    counts.invoices = invs.length; counts.payments = pays.length;

    // 3 wards with beds and admissions
    const wards = await ins("wards", [{ hospital_id: h, name: "Male Medical Ward (Demo)", type: "general", gender: "male", floor: "Ground floor", created_by: c.userId },
      { hospital_id: h, name: "Female Medical Ward (Demo)", type: "general", gender: "female", floor: "First floor", created_by: c.userId },
      { hospital_id: h, name: "Private Rooms (Demo)", type: "private", gender: "any", floor: "Second floor", created_by: c.userId }]);
    const beds = await ins("beds", [
      ...Array.from({ length: 12 }, (_, i) => ({ hospital_id: h, ward_id: wards[0].id, label: `M-${i + 1}`, bed_class: "general", daily_rate: 2500, status: i === 10 ? "cleaning" : "free", has_oxygen: i < 4, created_by: c.userId })),
      ...Array.from({ length: 12 }, (_, i) => ({ hospital_id: h, ward_id: wards[1].id, label: `F-${i + 1}`, bed_class: "general", daily_rate: 2500, status: i === 11 ? "out_of_service" : "free", has_oxygen: i < 4, created_by: c.userId })),
      ...Array.from({ length: 6 }, (_, i) => ({ hospital_id: h, ward_id: wards[2].id, label: `P-${201 + i}`, bed_class: "private", daily_rate: 8000, status: "free", has_oxygen: true, created_by: c.userId }))],
      "id, ward_id, daily_rate");
    const males = pats.filter((p: { gender: string }) => p.gender === "male").slice(150 % 60, 150 % 60 + 6), females = pats.filter((p: { gender: string }) => p.gender === "female").slice(40, 46);
    const admitPlan = [...males.slice(0, 6).map((p: { id: string }, i: number) => ({ p, bed: beds[i], days: i + 1 })), ...females.slice(0, 5).map((p: { id: string }, i: number) => ({ p, bed: beds[12 + i], days: i + 2 })),
      ...females.slice(5, 6).map((p: { id: string }) => ({ p, bed: beds[24], days: 2 }))];
    const reasons = ["Pneumonia, needs IV antibiotics", "Dengue fever with low platelets", "Uncontrolled sugar", "Typhoid fever", "Severe dehydration", "Chest infection, observation"];
    const adms = await ins("admissions", admitPlan.map((a, i) => { const dm = doctors[i % 4 === 3 ? 6 : i % 4 === 2 ? 4 : i % 2]; return { hospital_id: h, patient_id: a.p.id, bed_id: a.bed.id, admitting_doctor_id: dm.id,
      department_id: dm.dep, admitted_at: new Date(Date.now() - a.days * 86400e3).toISOString(), status: "admitted", reason: reasons[i % reasons.length], deposit_amount: 20000, transfers: [], created_by: dm.user }; }));
    for (let i = 0; i < adms.length; i++) await db.from("beds").update({ status: "occupied", current_admission_id: adms[i].id }).eq("id", admitPlan[i].bed.id);
    const { error: de } = await db.from("deposits").insert(adms.map((a: { id: string }, i: number) => ({ hospital_id: h, patient_id: admitPlan[i].p.id, admission_id: a.id, amount: 20000,
      receipt_no: `RCP-DEMO-${yr}-${String(rcpN++).padStart(5, "0")}`, applied_amount: 0, payment_mode: "cash", note: "Admission deposit", received_by: cashier, shift_id: i < 2 ? shift.id : null,
      created_at: i < 2 ? new Date(Date.now() - 2 * 3600e3).toISOString() : new Date(Date.now() - admitPlan[i].days * 86400e3).toISOString() })));
    if (de) throw new Error(`deposits: ${de.message}`);
    const admInv = await ins("invoices", adms.map((a: { id: string }, i: number) => { const amt = Number(admitPlan[i].bed.daily_rate) * admitPlan[i].days;
      return { hospital_id: h, patient_id: admitPlan[i].p.id, admission_id: a.id, invoice_no: `INV-DEMO-${yr}-${String(invN++).padStart(5, "0")}`, payer_type: "self", total: amt, discount: 0, paid: 0, balance: amt, status: "open", created_by: recep }; }));
    await db.from("invoice_lines").insert(admInv.map((inv: { id: string }, i: number) => { const r = Number(admitPlan[i].bed.daily_rate), d = admitPlan[i].days;
      return { hospital_id: h, invoice_id: inv.id, description: "Room charges", qty: d, rate: r, amount: r * d, source_type: "room", source_id: `demo-room-${adms[i].id}`, posted_by: recep }; }));
    counts.wards = 3; counts.beds = beds.length; counts.admissions = adms.length;

    // Health Tracker: 10 linked patients with 14 days of readings
    const linked = pats.filter((_: unknown, i: number) => i % 20 === 0).slice(0, 10);
    const measRows: Record<string, unknown>[] = [];
    for (let li = 0; li < linked.length; li++) {
      const p = linked[li];
      const u = await mkUser(p.full_name, "patient", `patient${li + 1}`);
      await db.from("patients").update({ user_id: u }).eq("id", p.id);
      const [acct] = await ins("patient_accounts", [{ hospital_id: h, user_id: u, patient_id: p.id, linked_at: new Date(Date.now() - 20 * 86400e3).toISOString() }]);
      await ins("tracker_profiles", [{ patient_account_id: acct.id, patient_id: p.id, height_cm: int(150, 180), weight_kg: int(55, 90), blood_group: "B+", health_status: li % 2 ? "has_conditions" : "none",
        onboarding_done: true, consented_at: new Date().toISOString(), disclaimer_ack_at: new Date().toISOString(), targets: li < 5 ? { bp: { low: 90, high: 139, low_2: 60, high_2: 89 } } : {} }]);
      const hyper = li % 3 === 0, sugar = li % 2 === 1;
      for (let d = 13; d >= 0; d--) {
        const date = pkDate(-d);
        for (const hm of ["08:15", "20:30"]) { const sys = hyper ? int(132, 158) : int(110, 132);
          measRows.push({ patient_account_id: acct.id, patient_id: p.id, type: "bp", value_1: sys, value_2: Math.min(sys - 30, hyper ? int(84, 98) : int(70, 85)), unit: "mmHg", context: "sitting", measured_at: at(date, hm) }); }
        if (sugar) measRows.push({ patient_account_id: acct.id, patient_id: p.id, type: "glucose", value_1: int(105, 190), unit: "mg/dL", context: "fasting", measured_at: at(date, "07:30") });
        measRows.push({ patient_account_id: acct.id, patient_id: p.id, type: "pulse", value_1: int(66, 92), unit: "bpm", measured_at: at(date, "08:16") });
        if (d % 7 === 0) measRows.push({ patient_account_id: acct.id, patient_id: p.id, type: "weight", value_1: int(55, 90), unit: "kg", measured_at: at(date, "07:00") });
      }
      if (li < 5) await ins("connections", [{ patient_account_id: acct.id, patient_id: p.id, doctor_id: doctors[li % 2].id, patient_name: p.full_name, status: "active",
        permissions: { profile: true, conditions: true, measurements: true, symptoms: true, medicines: true }, responded_at: new Date().toISOString(), shared_at: new Date().toISOString() }]);
    }
    await ins("measurements", measRows);
    counts.linked_patients = linked.length; counts.readings = measRows.length;

    await audit(db, req, c, "demo.seed", "hospitals", h, null, counts);
    return json({ ok: true, data: { counts, accounts, note: "These passwords are shown only once. Save them now." } });
  } catch (e) {
    const r = await clearDemo(db, h);
    return fail("seed_failed", `Demo data couldn't be added (${(e as Error).message}). ${r.errors.length ? "Some partial rows remain; run Clear demo data." : "Nothing was left behind."}`, 500);
  }
});
