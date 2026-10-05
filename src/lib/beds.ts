import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const WARD_TYPES = ["general", "semi_private", "private", "hdu", "icu", "nicu", "isolation", "er"] as const;
export const WARD_GENDERS = ["male", "female", "any"] as const;
export const BED_STATUSES = ["free", "occupied", "cleaning", "reserved", "out_of_service"] as const;
export type BedStatus = (typeof BED_STATUSES)[number];

export type Ward = { id: string; name: string; type: string; gender: string; floor: string | null; is_active: boolean };
export type Bed = { id: string; ward_id: string; label: string; bed_class: string; daily_rate: number; status: BedStatus; current_admission_id: string | null; has_oxygen: boolean; has_ventilator: boolean; updated_at: string };

/** Fixed status colours (tokens in styles.css). */
export const BED_TONE: Record<BedStatus, "ok" | "urgent" | "caution" | "progress" | "inactive"> = {
  free: "ok", occupied: "urgent", cleaning: "caution", reserved: "progress", out_of_service: "inactive",
};
export const BED_TILE: Record<BedStatus, string> = {
  free: "bg-ok-soft text-ok-fg border-ok",
  occupied: "bg-urgent-soft text-urgent-fg border-urgent",
  cleaning: "bg-caution-soft text-caution-fg border-caution",
  reserved: "bg-progress-soft text-progress-fg border-progress",
  out_of_service: "bg-inactive-soft text-inactive-fg border-inactive",
};

/**
 * Manual status changes allowed from the bed board. Must mirror update-bed-status.
 * Occupied beds only change through discharge or transfer; out-of-service is admin-only.
 */
export const BED_TRANSITIONS: Record<BedStatus, BedStatus[]> = {
  free: ["reserved", "cleaning", "out_of_service"],
  cleaning: ["free", "out_of_service"],
  reserved: ["free"],
  out_of_service: ["free", "cleaning"],
  occupied: [],
};
export function allowedBedActions(status: BedStatus, isAdmin: boolean): BedStatus[] {
  return BED_TRANSITIONS[status].filter((to) => isAdmin || (to !== "out_of_service" && status !== "out_of_service"));
}

export function useWards() {
  return useQuery({ queryKey: ["wards"], queryFn: async () => {
    const { data, error } = await supabase.from("wards" as never).select("*").order("name");
    if (error) throw error;
    return (data ?? []) as unknown as Ward[];
  } });
}

export function useBeds() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase.channel(`beds-live-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "beds" }, () => qc.invalidateQueries({ queryKey: ["beds"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
  return useQuery({ queryKey: ["beds"], queryFn: async () => {
    const { data, error } = await supabase.from("beds" as never).select("*").order("label");
    if (error) throw error;
    return ((data ?? []) as unknown as Bed[]).map((b) => ({ ...b, daily_rate: Number(b.daily_rate) }));
  } });
}

/** Natural sort so A2 comes before A10. */
export const byLabel = (a: Bed, b: Bed) => a.label.localeCompare(b.label, "en", { numeric: true });
