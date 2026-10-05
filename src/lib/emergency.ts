import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const TRIAGE_COLORS = ["red", "orange", "yellow", "green"] as const;
export type TriageColor = (typeof TRIAGE_COLORS)[number];
/** Minutes a patient may wait before being seen, per triage colour. */
export const TRIAGE_TARGET_MIN: Record<TriageColor, number> = { red: 0, orange: 10, yellow: 60, green: 120 };
/** Not yet triaged: must be triaged within 10 minutes. */
export const UNTRIAGED_TARGET_MIN = 10;
export const TRIAGE_TONE: Record<TriageColor, "urgent" | "warning" | "caution" | "ok"> = { red: "urgent", orange: "warning", yellow: "caution", green: "ok" };
export const TRIAGE_BG: Record<TriageColor, string> = {
  red: "bg-urgent text-primary-foreground", orange: "bg-warning text-primary-foreground", yellow: "bg-caution text-foreground", green: "bg-ok text-primary-foreground",
};
export const ARRIVAL_MODES = ["walk_in", "ambulance", "police", "referred"] as const;
export const DISPOSITIONS = ["admit", "discharge", "refer", "expired", "lama"] as const;

export interface MlcDetails { fir_no?: string; police_station?: string; officer_name?: string; officer_badge?: string; brought_by?: string; injury_summary?: string }
export interface EmergencyCase {
  id: string; patient_id: string; arrived_at: string; complaint: string; arrival_mode: string;
  triage_color: TriageColor | null; triaged_at: string | null; seen_by: string | null; seen_by_name: string | null; seen_at: string | null;
  bay_bed_id: string | null; mlc: boolean; mlc_details: MlcDetails; disposition: string | null; disposition_at: string | null;
  patients: { id: string; mrn: string; full_name: string; gender: string | null; dob: string | null; is_unknown: boolean; allergies: string[] } | null;
}

/** Open ER cases (no disposition yet), live via Realtime. */
export function useOpenEmergencyCases() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase.channel("er-cases")
      .on("postgres_changes", { event: "*", schema: "public", table: "emergency_cases" }, () => qc.invalidateQueries({ queryKey: ["er-cases"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
  return useQuery({
    queryKey: ["er-cases"],
    queryFn: async () => {
      const { data, error } = await supabase.from("emergency_cases" as never)
        .select("*, patients(id, mrn, full_name, gender, dob, is_unknown, allergies)").is("disposition", null).order("arrived_at");
      if (error) throw error;
      return (data ?? []) as unknown as EmergencyCase[];
    },
  });
}

/** Minutes waiting (until seen) and whether past the triage target. */
export function waitInfo(c: EmergencyCase, now: number) {
  const end = c.seen_at ? new Date(c.seen_at).getTime() : now;
  const minutes = Math.max(0, Math.floor((end - new Date(c.arrived_at).getTime()) / 60000));
  const target = c.triage_color ? TRIAGE_TARGET_MIN[c.triage_color] : UNTRIAGED_TARGET_MIN;
  return { minutes, overdue: !c.seen_at && minutes >= target, target };
}

export const triageRank = (c: EmergencyCase) => (c.triage_color ? TRIAGE_COLORS.indexOf(c.triage_color) : -1);

export const ER_INVALIDATE = [["er-cases"], ["beds"], ["bed-requests"], ["patient-summary"]];
