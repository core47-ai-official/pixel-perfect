import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import type { Vitals } from "@/lib/visits";

export const SHIFTS = ["morning", "evening", "night"] as const;
export type Shift = (typeof SHIFTS)[number];

/** Pakistan time shifts: morning 08–14, evening 14–20, night 20–08 (night belongs to the date it started). */
export function currentShift(now = new Date()): { date: string; shift: Shift } {
  const pk = new Date(now.getTime() + 5 * 3600000);
  const h = pk.getUTCHours();
  if (h < 8) pk.setUTCDate(pk.getUTCDate() - 1);
  return { date: pk.toISOString().slice(0, 10), shift: h >= 8 && h < 14 ? "morning" : h >= 14 && h < 20 ? "evening" : "night" };
}

export interface BoardBed {
  id: string; ward_id: string; label: string; status: string; has_oxygen: boolean; has_ventilator: boolean;
  admission_id: string | null; admitted_at: string | null; days_admitted: number | null;
  patient: { id: string; mrn: string; full_name: string; gender: string | null; dob: string | null; allergies: string[] } | null;
  latest_vitals: Vitals | null; vitals_due_at: string | null;
}
export interface WardBoard {
  wards: { id: string; name: string; type: string; gender: string; floor: string | null }[];
  beds: BoardBed[]; due_hours: number; assigned: boolean;
}

export function useWardBoard() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase.channel("ward-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "beds" }, () => qc.invalidateQueries({ queryKey: ["ward-board"] }))
      .subscribe();
    // Refresh "due" states every minute.
    const iv = setInterval(() => qc.invalidateQueries({ queryKey: ["ward-board"] }), 60000);
    return () => { supabase.removeChannel(ch); clearInterval(iv); };
  }, [qc]);
  return useQuery({ queryKey: ["ward-board"], queryFn: () => callEdgeFunction<WardBoard>("get-ward-board", {}), retry: false });
}

export interface HandoverNote { id: string; ward_id: string; shift_date: string; shift: Shift; note: string; written_by_name: string; created_at: string }

export function useHandoverNotes(wardId: string | null, date: string) {
  return useQuery({
    queryKey: ["handover", wardId, date],
    enabled: !!wardId,
    queryFn: async () => {
      const { data, error } = await supabase.from("handover_notes" as never).select("*").eq("ward_id", wardId!).eq("shift_date", date).order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as HandoverNote[];
    },
  });
}
