import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/hooks/use-edge-function";

export interface PortalPatient { id: string; full_name: string; mrn: string; phone: string | null; dob: string | null; gender: string | null; print_language: string | null }

/** The signed-in patient's own linked record (RLS: patients.user_id = auth.uid()); null until linked. */
export const myPatientQuery = queryOptions({
  queryKey: ["portal", "me"],
  queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return null;
    const { data, error } = await supabase.from("patients")
      .select("id, full_name, mrn, phone, dob, gender, print_language").eq("user_id", u.user.id).maybeSingle();
    if (error) throw error;
    return (data as PortalPatient | null) ?? null;
  },
});
export const useMyPatient = () => useQuery(myPatientQuery);

export const firstName = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] ?? "";

export const pkDay = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
export const pkTime = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export interface PortalSettings { allow_patient_booking: boolean; cancellation_hours: number; booking_window_days: number }
export interface PortalHome {
  linked: boolean; settings: PortalSettings;
  patient?: { id: string; full_name: string; mrn: string; print_language: string | null };
  next_appointment?: { id: string; slot_start: string; token_no: number | null; status: string; doctor_name: string | null; department_name: string | null } | null;
  latest_reports?: { id: string; verified_at: string | null; has_critical: boolean; test_name: string | null }[];
  balance_due?: number; open_bills?: number;
}
/** Portal Home in one call (get-patient-portal-home); also the source of booking/cut-off settings. */
export const portalHomeQuery = queryOptions({
  queryKey: ["portal", "home"],
  queryFn: () => callEdgeFunction<PortalHome>("get-patient-portal-home", {}),
  staleTime: 30_000, retry: false,
});
export const usePortalHome = () => useQuery(portalHomeQuery);

/** True while the appointment can still be changed by the patient (status + company cut-off hours). */
export const canChange = (a: { status: string; slot_start: string }, hours: number) =>
  ["booked", "waiting", "needs_rebooking"].includes(a.status) && new Date(a.slot_start).getTime() - Date.now() >= hours * 3600_000;

/** Next n Pakistan-calendar days as YYYY-MM-DD, starting today. */
export function pkNextDays(n: number) {
  const base = Date.now() + 5 * 3600_000;
  return Array.from({ length: n }, (_, i) => new Date(base + i * 86400_000).toISOString().slice(0, 10));
}
export const pkDateLabel = (ymdStr: string, lng: string) =>
  new Date(`${ymdStr}T12:00:00+05:00`).toLocaleDateString(lng === "ur" ? "ur-PK" : "en-GB", { timeZone: "Asia/Karachi", weekday: "short", day: "numeric", month: "short" });
