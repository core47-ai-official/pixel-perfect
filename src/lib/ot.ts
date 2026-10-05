import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyContext } from "@/hooks/use-my-context";

export const OT_TYPES = ["major", "minor", "cardiac", "obstetric"] as const;
export const OT_STATUSES = ["active", "maintenance", "inactive"] as const;
export const OT_BOOKING_STATUSES = ["requested", "scheduled", "in_progress", "completed", "cancelled", "bumped"] as const;
export const OT_SCHEDULERS = ["super_admin", "admin", "ot_coordinator"] as const;
export const OT_REQUESTERS = ["super_admin", "admin", "doctor", "dept_head", "ot_coordinator"] as const;

export interface Theatre { id: string; name: string; type: string; status: string }
export interface OtBooking {
  id: string; ot_id: string | null; patient_id: string; admission_id: string | null; surgeon_id: string; anesthetist_id: string | null;
  team_ids: string[]; procedure: string; planned_start: string | null; planned_minutes: number; cleaning_minutes: number;
  priority: "emergency" | "elective"; status: string; bump_reason: string | null; note: string | null;
  actual_start: string | null; actual_end: string | null; created_at: string;
  patients: { full_name: string; mrn: string } | null;
}

const SELECT = "*, patients(full_name, mrn)";

export function useTheatres() {
  const { context } = useMyContext();
  const hid = context?.hospital?.id;
  return useQuery({
    queryKey: ["ot", "theatres", hid], enabled: !!hid,
    queryFn: async () => {
      const { data, error } = await supabase.from("operation_theatres").select("id, name, type, status").order("name");
      if (error) throw error;
      return data as Theatre[];
    },
  });
}

/** Scheduled/running/done cases whose planned start falls in [fromIso, toIso). */
export function useOtBookings(fromIso: string, toIso: string, enabled = true) {
  return useQuery({
    queryKey: ["ot", "bookings", fromIso, toIso], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("ot_bookings").select(SELECT)
        .in("status", ["scheduled", "in_progress", "completed"]).gte("planned_start", fromIso).lt("planned_start", toIso).order("planned_start");
      if (error) throw error;
      return data as unknown as OtBooking[];
    },
  });
}

/** Requests inbox: waiting requests and bumped cases that need a new time. */
export function useOtRequests() {
  return useQuery({
    queryKey: ["ot", "requests"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ot_bookings").select(SELECT).in("status", ["requested", "bumped"])
        .order("priority", { ascending: true }).order("created_at");
      if (error) throw error;
      return data as unknown as OtBooking[];
    },
  });
}

export function useOtRealtime(hospitalId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!hospitalId) return;
    const ch = supabase.channel(`ot-${hospitalId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ot_bookings", filter: `hospital_id=eq.${hospitalId}` },
        () => void qc.invalidateQueries({ queryKey: ["ot"] }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [hospitalId, qc]);
}

export const caseEnd = (b: Pick<OtBooking, "planned_start" | "planned_minutes">) =>
  new Date(new Date(b.planned_start!).getTime() + b.planned_minutes * 60_000);
