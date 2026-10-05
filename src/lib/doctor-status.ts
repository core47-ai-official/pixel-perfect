import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Status } from "@/components/mc/status-chip";

export const DOCTOR_STATUSES = ["available", "in_opd", "in_surgery", "on_round", "on_leave", "off_duty"] as const;
export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];
export const STATUS_TONE: Record<string, Status> = {
  available: "ok", in_opd: "progress", in_surgery: "urgent", on_round: "caution", on_leave: "warning", off_duty: "inactive",
};
export const toneFor = (s: string): Status => STATUS_TONE[s] ?? "inactive";

/** Live updates: any change to this hospital's doctors refreshes every ["doctors"] query. */
export function useDoctorsRealtime(hospitalId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel(`doctors-${hospitalId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "doctors", filter: `hospital_id=eq.${hospitalId}` },
        () => { void qc.invalidateQueries({ queryKey: ["doctors"] }); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [hospitalId, qc]);
}
