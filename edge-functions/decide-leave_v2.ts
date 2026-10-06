// Paste into Supabase → Edge Functions → new function "decide-leave". Turn "Enforce JWT Verification" OFF.
// Input: { leave_id, decision: "approved" | "rejected", note? }
// Allowed: admin, super_admin, or dept_head of the doctor's department (not for their own leave).
// On approval: doctor status → on_leave if the leave covers today; booked appointments in the range →
// status "needs_rebooking"; a notification goes to each affected patient (if they have an app account) and to reception.
//
// Appointments: this expects an "appointments" table with columns
//   id, hospital_id, doctor_id, slot_start (timestamptz), status (text), patient_id
// and a "patients" table with id, user_id. If those tables don't exist yet, that part is skipped safely.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);

// ---- notification helpers (identical wherever they appear; mirrors src/config/notification-types.ts) ----
// Every event notification goes through queueNotes: it applies the hospital's English/Urdu template for the type
// (company settings → notifications → tpl_<type>_<en|ur>, first line = title, rest = body, {placeholders} from vars),
// picks the recipient's language (patient print language, otherwise staff UI language), skips non-critical types the
// recipient turned off, and ignores duplicates by dedupe_key. Critical types can never be turned off.
const NOTE_CRITICAL = ["critical_result", "ot_bumped"];
const NOTE_DEFAULTS: Record<string, { en: string; ur: string }> = {
  appointment_booked: { en: "Appointment confirmed\n{doctor} · {date} {time} · Token {token}", ur: "اپائنٹمنٹ کنفرم\n{doctor} · {date} {time} · ٹوکن {token}" },
  appointment_reminder: { en: "Appointment reminder\nYou see {doctor} on {date} at {time} (token {token}).", ur: "اپائنٹمنٹ یاد دہانی\n{date} کو {time} بجے {doctor} سے ملاقات ہے (ٹوکن {token})۔" },
  appointment_cancelled: { en: "Appointment cancelled\n{doctor} · {date} {time}. {reason}", ur: "اپائنٹمنٹ منسوخ\n{doctor} · {date} {time}۔ {reason}" },
  appointment_rescheduled: { en: "Appointment rescheduled\nNew time: {doctor} · {date} {time} · Token {token}", ur: "اپائنٹمنٹ کا وقت تبدیل\nنیا وقت: {doctor} · {date} {time} · ٹوکن {token}" },
  report_ready: { en: "Lab report ready\n{test} report for {patient} is ready.", ur: "لیب رپورٹ تیار\n{patient} کی {test} رپورٹ تیار ہے۔" },
  critical_result: { en: "URGENT: critical result — {patient}\n{test} (MRN {mrn}): {values}", ur: "فوری: خطرناک نتیجہ — {patient}\n{test} (ایم آر این {mrn}): {values}" },
  leave_decision: { en: "Leave {status}\n{from} to {to}. {note}", ur: "چھٹی {status}\n{from} سے {to}۔ {note}" },
  approval_decision: { en: "{kind} request {status}\n{invoice} · Rs {amount}. {note}", ur: "{kind} درخواست {status}\n{invoice} · روپے {amount}۔ {note}" },
  ot_bumped: { en: "Your OT case was moved for an emergency\n{procedure}: {reason}", ur: "ایمرجنسی کی وجہ سے آپ کا آپریشن منتقل ہوا\n{procedure}: {reason}" },
  stock_low: { en: "{count} medicine(s) below reorder level\n{items}", ur: "{count} ادویات ری آرڈر حد سے کم\n{items}" },
  followup_due: { en: "Follow-up visit tomorrow\nPlease visit the hospital on {date} for your follow-up after discharge.", ur: "کل فالو اپ معائنہ\nڈسچارج کے بعد فالو اپ کے لیے {date} کو ہسپتال تشریف لائیں۔" },
};
const NOTE_WORDS: Record<string, Record<string, string>> = {
  ur: { approved: "منظور", rejected: "نامنظور", discount: "رعایت", waiver: "معافی", refund: "واپسی", reversal: "منسوخی" },
};
/** Maps legacy/variant type names to their preference category. */
const noteCategory = (type: string) => type.startsWith("leave_") ? "leave_decision" : type.startsWith("approval_") ? "approval_decision" : type === "followup_reminder" ? "followup_due" : type;
const fillNote = (tpl: string, vars: Record<string, unknown>, lang: string) =>
  tpl.replace(/\{(\w+)\}/g, (_m, k) => { const v = vars[k]; if (v == null) return ""; const s = String(v); return NOTE_WORDS[lang]?.[s] ?? s; }).replace(/\s+([.،۔])\s*$/g, "$1").trim();
const notePkDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric" });
const notePkTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit" });
interface NoteIn {
  hospital_id: string; user_id: string; type: string; title?: string; body?: string; link?: string | null; created_by?: string | null;
  channel?: string; scheduled_at?: string | null; dedupe_key?: string | null; vars?: Record<string, unknown>;
}
// deno-lint-ignore no-explicit-any
async function queueNotes(db: any, input: NoteIn | NoteIn[]): Promise<{ error: unknown; count: number }> {
  const rows = (Array.isArray(input) ? input : [input]).filter((r) => r && r.user_id);
  if (!rows.length) return { error: null, count: 0 };
  const hospitalId = rows[0].hospital_id;
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const [{ data: cs }, { data: prefs }, { data: profs }, { data: pats }] = await Promise.all([
    db.from("company_settings").select("notifications, localization").eq("hospital_id", hospitalId).maybeSingle(),
    db.from("notification_preferences").select("user_id, disabled_types").in("user_id", ids),
    db.from("profiles").select("id, preferences").in("id", ids),
    db.from("patients").select("user_id, print_language").in("user_id", ids),
  ]);
  const cfg = (cs?.notifications ?? {}) as Record<string, unknown>;
  const defLang = String(cs?.localization?.default_language ?? "en");
  const off = new Map<string, string[]>((prefs ?? []).map((p: { user_id: string; disabled_types: string[] }) => [p.user_id, p.disabled_types ?? []]));
  const langOf = (u: string) => {
    const pt = (pats ?? []).find((p: { user_id: string }) => p.user_id === u);
    if (pt) return pt.print_language === "ur" ? "ur" : "en";
    const pr = (profs ?? []).find((p: { id: string }) => p.id === u);
    const l = pr?.preferences?.language ?? defLang;
    return l === "ur" ? "ur" : "en";
  };
  const out = [];
  for (const r of rows) {
    const cat = noteCategory(r.type);
    const critical = NOTE_CRITICAL.includes(cat);
    if (!critical && (off.get(r.user_id) ?? []).includes(cat)) continue;
    let title = r.title ?? "", body = r.body ?? "";
    if (r.vars) {
      const lang = langOf(r.user_id);
      const tpl = String(cfg[`tpl_${cat}_${lang}`] || "") || (lang === "ur" ? String(cfg[`tpl_${cat}_en`] || "") || NOTE_DEFAULTS[cat]?.ur : String(cfg[`tpl_${cat}_en`] || "") || NOTE_DEFAULTS[cat]?.en) || "";
      if (tpl) {
        const [t1, ...rest] = fillNote(tpl, r.vars, lang).split("\n");
        title = t1.trim() || title; body = rest.join("\n").trim() || body;
      }
    }
    out.push({ hospital_id: r.hospital_id, user_id: r.user_id, type: r.type, channel: r.channel ?? "push", title: title.slice(0, 200), body: body.slice(0, 1000),
      link: r.link ?? null, created_by: r.created_by ?? null, scheduled_at: r.scheduled_at ?? null, dedupe_key: r.dedupe_key ?? null, priority: critical ? "critical" : "normal" });
  }
  if (!out.length) return { error: null, count: 0 };
  const { error } = await db.from("notifications").upsert(out, { onConflict: "dedupe_key", ignoreDuplicates: true });
  return { error, count: error ? 0 : out.length };
}
// ---- end notification helpers ----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return fail("unauthorized", "Please sign in again.", 401);
  let userId = u.user.id;
  let impersonatedBy: string | null = null;
  const impId = req.headers.get("x-impersonation-session");
  if (impId) {
    const { data: s } = await db.from("impersonation_sessions").select("*").eq("id", impId).maybeSingle();
    if (!s || s.super_admin_id !== userId || s.ended_at || new Date(s.expires_at) < new Date())
      return fail("forbidden", "Acting session is not active.", 403);
    impersonatedBy = userId; userId = s.target_user_id;
  }
  const { data: prof } = await db.from("profiles").select("hospital_id, is_active").eq("id", userId).maybeSingle();
  if (!prof?.is_active) return fail("forbidden", "Account is not active.", 403);
  const hospitalId = prof.hospital_id;
  const { data: myRoles } = await db.from("user_roles").select("role, department_id").eq("user_id", userId).eq("hospital_id", hospitalId);

  const b = await req.json().catch(() => ({}));
  const decision = String(b.decision ?? "");
  if (decision !== "approved" && decision !== "rejected") return fail("validation", "Decision must be approved or rejected.");
  const note = b.note ? String(b.note).trim().slice(0, 500) : null;

  const { data: leave } = await db.from("doctor_leaves").select("*").eq("id", String(b.leave_id ?? "")).eq("hospital_id", hospitalId).maybeSingle();
  if (!leave) return fail("not_found", "Leave request not found.", 404);
  if (leave.status !== "pending") return fail("conflict", "This request has already been decided.", 409);
  const { data: doc } = await db.from("doctors").select("id, user_id, department_id, status").eq("id", leave.doctor_id).single();
  if (!doc) return fail("not_found", "Doctor not found.", 404);

  const rs = myRoles ?? [];
  const isAdmin = rs.some((r) => r.role === "admin" || r.role === "super_admin");
  const isHead = rs.some((r) => r.role === "dept_head" && r.department_id && r.department_id === doc.department_id);
  if (!isAdmin && !isHead) return fail("forbidden", "You can't decide this leave request.", 403);
  if (doc.user_id === userId && !isAdmin) return fail("forbidden", "You can't approve your own leave.", 403);

  let affected = 0;
  if (decision === "approved") {
    const today = new Date().toISOString().slice(0, 10);
    if (leave.from_date <= today && leave.to_date >= today && doc.status !== "on_leave") {
      await db.from("doctors").update({ status: "on_leave", updated_at: new Date().toISOString() }).eq("id", doc.id);
    }

    const { data: appts, error: apErr } = await db.from("appointments")
      .select("id, patient_id, slot_start")
      .eq("hospital_id", hospitalId).eq("doctor_id", doc.id)
      .gte("slot_start", `${leave.from_date}T00:00:00+05:00`).lte("slot_start", `${leave.to_date}T23:59:59+05:00`)
      .in("status", ["booked", "waiting"]);
    if (!apErr && appts?.length) {
      affected = appts.length;
      await db.from("appointments").update({ status: "needs_rebooking", updated_at: new Date().toISOString() })
        .in("id", appts.map((a) => a.id));

      const notes: Record<string, unknown>[] = [];
      const patientIds = [...new Set(appts.map((a) => a.patient_id).filter(Boolean))];
      if (patientIds.length) {
        const { data: pts } = await db.from("patients").select("id, user_id").in("id", patientIds);
        for (const a of appts) {
          const pu = pts?.find((p) => p.id === a.patient_id)?.user_id;
          if (pu) notes.push({
            hospital_id: hospitalId, user_id: pu, type: "appointment_needs_rebooking",
            title: "Your appointment needs to be rebooked",
            body: `Your doctor is unavailable on ${String(a.slot_start).slice(0, 10)}. Please contact reception to choose a new time.`,
            link: "/my-appointments", created_by: userId,
          });
        }
      }
      const { data: reception } = await db.from("user_roles").select("user_id").eq("hospital_id", hospitalId).eq("role", "receptionist");
      for (const r of new Set((reception ?? []).map((x) => x.user_id))) notes.push({
        hospital_id: hospitalId, user_id: r, type: "appointments_need_rebooking",
        title: `${affected} appointment(s) need rebooking`,
        body: `Doctor on leave ${leave.from_date} to ${leave.to_date}.`, link: "/appointments", created_by: userId,
      });
      if (notes.length) await queueNotes(db, notes as unknown as NoteIn[]);
    }
  }

  const { data: after, error } = await db.from("doctor_leaves").update({
    status: decision, decided_by: userId, decided_at: new Date().toISOString(), decision_note: note,
    affected_appointments: affected, updated_at: new Date().toISOString(),
  }).eq("id", leave.id).select().single();
  if (error) return fail("db", error.message);

  await queueNotes(db, {
    hospital_id: hospitalId, user_id: doc.user_id, type: "leave_decision",
    title: decision === "approved" ? "Your leave was approved" : "Your leave was not approved",
    body: `${leave.from_date} to ${leave.to_date}${note ? ` — ${note}` : ""}`, link: "/my-leave", created_by: userId,
    vars: { status: decision, from: leave.from_date, to: leave.to_date, note: note ?? "" },
  });
  await db.from("audit_logs").insert({
    hospital_id: hospitalId, user_id: userId, impersonated_by: impersonatedBy,
    action: decision === "approved" ? "approve" : "reject", resource: "doctor_leave", resource_id: leave.id,
    before: leave, after, ip: req.headers.get("x-forwarded-for"),
  });
  return json({ ok: true, data: after });
});
