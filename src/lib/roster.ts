import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const SHIFT_TYPES = ["morning", "evening", "night", "on_call"] as const;
export type ShiftType = (typeof SHIFT_TYPES)[number];

export interface RosterShift {
  id?: string; user_id: string; date: string; shift: ShiftType; start_time: string; end_time: string;
  ward_id?: string | null; department_id?: string | null; note?: string | null;
  checked_in_at?: string | null; checked_out_at?: string | null;
}
export interface RosterStaff { user_id: string; name: string; roles: string[]; department_id: string | null; ward_ids: string[] }
export interface RosterWarning { kind: "double" | "rest" | "leave"; user_id: string; name: string; date: string; message: string }
export interface RosterWeek {
  week_start: string; staff: RosterStaff[]; shifts: RosterShift[];
  leaves: { user_id: string; from_date: string; to_date: string; type: string }[];
  warnings: RosterWarning[]; shift_times: Record<ShiftType, [string, string]>;
}
export interface SaveResult { saved: boolean; needs_confirm?: boolean; warnings: RosterWarning[]; count?: number }

/** Local (browser) date → YYYY-MM-DD. */
export const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDaysYmd = (d: string, n: number) => ymdLocal(new Date(new Date(`${d}T00:00:00`).getTime() + n * 86400e3 + 3600e3));
export const mondayOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymdLocal(x); };

/** Start/end Date of a shift; an end at or before the start runs into the next day. */
export function shiftSpan(s: Pick<RosterShift, "date" | "start_time" | "end_time">) {
  const start = new Date(`${s.date}T${s.start_time.slice(0, 5)}:00`);
  let end = new Date(`${s.date}T${s.end_time.slice(0, 5)}:00`);
  if (end <= start) end = new Date(end.getTime() + 86400e3);
  return { start, end };
}

/** The signed-in user's own shifts (RLS: own rows) between two dates. */
export function useMyShifts(userId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["my-shifts", userId, from, to], enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("roster_shifts" as never).select("id, user_id, date, shift, start_time, end_time, ward_id, checked_in_at, checked_out_at")
        .eq("user_id", userId!).gte("date", from).lte("date", to).order("date");
      if (error) throw error;
      return data as unknown as RosterShift[];
    },
  });
}
