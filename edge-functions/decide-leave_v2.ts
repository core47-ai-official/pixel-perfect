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
      if (notes.length) await db.from("notifications").insert(notes);
    }
  }

  const { data: after, error } = await db.from("doctor_leaves").update({
    status: decision, decided_by: userId, decided_at: new Date().toISOString(), decision_note: note,
    affected_appointments: affected, updated_at: new Date().toISOString(),
  }).eq("id", leave.id).select().single();
  if (error) return fail("db", error.message);

  await db.from("notifications").insert({
    hospital_id: hospitalId, user_id: doc.user_id, type: `leave_${decision}`,
    title: decision === "approved" ? "Your leave was approved" : "Your leave was not approved",
    body: `${leave.from_date} to ${leave.to_date}${note ? ` — ${note}` : ""}`, link: "/my-leave", created_by: userId,
  });
  await db.from("audit_logs").insert({
    hospital_id: hospitalId, user_id: userId, impersonated_by: impersonatedBy,
    action: decision === "approved" ? "approve" : "reject", resource: "doctor_leave", resource_id: leave.id,
    before: leave, after, ip: req.headers.get("x-forwarded-for"),
  });
  return json({ ok: true, data: after });
});
