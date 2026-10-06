import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MedSchedule {
  id: string; name: string; dose: string | null; times: string[]; active: boolean; source: string;
  start_date: string; end_date: string | null; frequency: string | null; duration_days: number | null; instructions: string | null;
}
export interface DoseEvent {
  id: string; schedule_id: string; due_at: string; status: string | null; logged_at: string | null; snoozed_until: string | null;
}

const PK = 5 * 3600e3;
const dayStart = (offsetDays: number) => {
  const d = new Date(Date.now() + PK).toISOString().slice(0, 10);
  return new Date(Date.parse(`${d}T00:00:00Z`) - PK + offsetDays * 86400e3).toISOString();
};

/** Medicines plus the last 30 days of doses and the rest of today (RLS: own rows only). */
export function useMedicines() {
  return useQuery({
    queryKey: ["tracker-medicines"],
    queryFn: async () => {
      const [s, e] = await Promise.all([
        supabase.from("medication_schedules").select("*").order("created_at", { ascending: false }),
        supabase.from("dose_events").select("id, schedule_id, due_at, status, logged_at, snoozed_until")
          .gte("due_at", dayStart(-30)).lt("due_at", dayStart(1)).order("due_at"),
      ]);
      if (s.error) throw s.error;
      if (e.error) throw e.error;
      return { schedules: (s.data ?? []) as MedSchedule[], events: (e.data ?? []) as DoseEvent[] };
    },
  });
}

export const isToday = (iso: string) => iso >= dayStart(0) && iso < dayStart(1);

/** Adherence = taken ÷ doses already decided (taken, skipped or missed). null when none yet. */
export function adherence(events: DoseEvent[]): number | null {
  const done = events.filter((e) => e.status);
  if (!done.length) return null;
  return Math.round((done.filter((e) => e.status === "taken").length / done.length) * 100);
}
