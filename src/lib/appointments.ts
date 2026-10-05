import { useQuery } from "@tanstack/react-query";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { supabase } from "@/integrations/supabase/client";

export const APPT_TYPES = ["new", "follow_up", "procedure"] as const;
export const APPT_STATUSES = ["booked", "waiting", "in_consultation", "done", "no_show", "cancelled", "needs_rebooking"] as const;
export type ApptType = (typeof APPT_TYPES)[number];

export interface BookableDoctor {
  id: string; user_id: string; full_name: string; department_id: string | null; specialty: string;
  gender: string | null; languages: string[]; consultation_fee: number; followup_fee: number; status: string;
}
export interface Slot { start: string; end: string; time: string; status: "free" | "booked" | "full" | "past"; room: string | null }
export interface SlotsResult { closed: null | "on_leave" | "holiday" | "no_schedule"; holiday?: string; slots: Slot[] }
export interface Appointment {
  id: string; patient_id: string; doctor_id: string; department_id: string | null; slot_start: string; slot_end: string;
  token_no: number | null; type: ApptType; channel: string; status: string; fee: number; cancel_reason: string | null;
}
export interface BookedAppointment extends Appointment { time: string; room: string | null; doctor_name: string | null; department_name: string | null }

/** Doctors with names (names come through the server because reception can't read staff profiles). */
export function useBookableDoctors(enabled = true) {
  return useQuery({
    queryKey: ["doctors", "bookable"],
    queryFn: () => callEdgeFunction<BookableDoctor[]>("get-available-slots", { list_doctors: true }),
    enabled, staleTime: 60_000, retry: false,
  });
}

export function useSlots(doctorId: string | null, date: string | null) {
  return useQuery({
    queryKey: ["appointments", "slots", doctorId, date],
    queryFn: () => callEdgeFunction<SlotsResult>("get-available-slots", { doctor_id: doctorId, date }),
    enabled: !!doctorId && !!date, retry: false,
  });
}

/** Local (Pakistan) calendar date for a Date picked in the UI. */
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const pkTime = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(11, 16);
export const pkDate = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 10);

export function useDayAppointments(date: string) {
  return useQuery({
    queryKey: ["appointments", "day", date],
    queryFn: async () => {
      const { data, error } = await supabase.from("appointments")
        .select("*, patients(full_name, mrn)")
        .gte("slot_start", `${date}T00:00:00+05:00`).lte("slot_start", `${date}T23:59:59+05:00`)
        .order("slot_start");
      if (error) throw error;
      return data as unknown as (Appointment & { patients: { full_name: string; mrn: string } | null })[];
    },
  });
}
