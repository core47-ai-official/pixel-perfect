import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const LEAVE_TYPES = ["casual", "sick", "annual", "conference", "emergency", "other"] as const;
export interface Leave {
  id: string; doctor_id: string; from_date: string; to_date: string; type: string; reason: string;
  status: "pending" | "approved" | "rejected"; decided_by: string | null; decided_at: string | null;
  decision_note: string | null; affected_appointments: number; created_at: string;
}
export const LEAVE_TONE = { pending: "caution", approved: "ok", rejected: "inactive" } as const;

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function useLeaves(hospitalId: string | undefined, doctorId?: string) {
  return useQuery({
    queryKey: ["doctor-leaves", hospitalId, doctorId ?? "all"],
    enabled: !!hospitalId,
    queryFn: async () => {
      let q = supabase.from("doctor_leaves").select("*").order("from_date", { ascending: false }).limit(500);
      if (doctorId) q = q.eq("doctor_id", doctorId);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as Leave[];
    },
  });
}

/** Doctor ids with approved leave covering today — shown as "On leave" even before anyone switches status. */
export function onLeaveToday(leaves: Leave[] | undefined) {
  const t = todayISO();
  return new Set((leaves ?? []).filter((l) => l.status === "approved" && l.from_date <= t && l.to_date >= t).map((l) => l.doctor_id));
}
