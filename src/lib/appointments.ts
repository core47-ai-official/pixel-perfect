import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { supabase } from "@/integrations/supabase/client";

export const APPT_TYPES = ["new", "follow_up", "procedure"] as const;
export const APPT_STATUSES = ["booked", "waiting", "in_consultation", "done", "no_show", "cancelled", "needs_rebooking"] as const;
export type ApptType = (typeof APPT_TYPES)[number];

export interface BookableDoctor {
  id: string; user_id: string; full_name: string; department_id: string | null; specialty: string;
  gender: string | null; languages: string[]; consultation_fee: number; followup_fee: number; status: string;
  photo_url?: string | null; department_name?: string | null;
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

export interface ScheduleRow { doctor_id: string; weekday: number; start_time: string; end_time: string; slot_minutes: number; room: string | null }
export interface LeaveRow { doctor_id: string; from_date: string; to_date: string; type: string }
export type RangeAppointment = Appointment & { patients: { full_name: string; mrn: string } | null };

/** Appointments, schedules and approved leave for a date range (staff RLS reads). */
export function useCalendarData(from: string, to: string) {
  const appts = useQuery({
    queryKey: ["appointments", "range", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.from("appointments").select("*, patients(full_name, mrn)")
        .gte("slot_start", `${from}T00:00:00+05:00`).lte("slot_start", `${to}T23:59:59+05:00`).order("slot_start");
      if (error) throw error;
      return data as unknown as RangeAppointment[];
    },
  });
  const schedules = useQuery({
    queryKey: ["doctor-schedules", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("doctor_schedules").select("doctor_id, weekday, start_time, end_time, slot_minutes, room");
      if (error) throw error;
      return data as ScheduleRow[];
    },
    staleTime: 60_000,
  });
  const leaves = useQuery({
    queryKey: ["doctor-leaves", "approved", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.from("doctor_leaves").select("doctor_id, from_date, to_date, type")
        .eq("status", "approved").lte("from_date", to).gte("to_date", from);
      if (error) throw error;
      return data as LeaveRow[];
    },
  });
  return { appts, schedules, leaves };
}

/** Live updates: any appointment change in the hospital refreshes appointment queries. */
export function useAppointmentsRealtime(hospitalId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel(`appointments-${hospitalId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `hospital_id=eq.${hospitalId}` },
        () => { void qc.invalidateQueries({ queryKey: ["appointments"] }); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [hospitalId, qc]);
}
