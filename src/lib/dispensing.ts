import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RxQueueRow {
  id: string; status: string; created_at: string; patient_id: string; warnings: unknown;
  patients: { full_name: string; mrn: string; print_language: string | null } | null;
  prescription_items: { id: string }[];
}

export function useRxQueue(hospitalId: string | undefined) {
  return useQuery({
    queryKey: ["rx-queue", hospitalId],
    enabled: !!hospitalId,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 86400e3).toISOString();
      const { data, error } = await supabase.from("prescriptions")
        .select("id, status, created_at, patient_id, warnings, patients(full_name, mrn, print_language), prescription_items(id)")
        .eq("hospital_id", hospitalId!).in("status", ["active", "partly_dispensed"]).gte("created_at", since)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as RxQueueRow[];
    },
  });
}

/** Live refresh of the prescription queue; unique channel name per hook instance. */
export function useRxRealtime(hospitalId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!hospitalId) return;
    const ch = supabase.channel(`rx-${hospitalId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "prescriptions", filter: `hospital_id=eq.${hospitalId}` },
        () => { void qc.invalidateQueries({ queryKey: ["rx-queue"] }); void qc.invalidateQueries({ queryKey: ["rx-preview"] }); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [hospitalId, qc]);
}

export interface PreviewBatch { batch_id: string; batch_no: string; expiry_date: string; qty: number; on_hand: number }
export interface PreviewItem {
  item_id: string; medicine_id: string; medicine_name: string; dose: string; frequency: string; route: string;
  duration_days: number | null; instructions_en: string; instructions_ur: string; quantity: number; dispensed: number;
  remaining: number; unit_price: number; stock: number; suggested: PreviewBatch[]; warnings: string[];
  alternatives: { id: string; name: string; stock: number; unit_price: number }[];
}
export interface DispensedLine { id: string; item_id: string; qty: number; unit_price: number; medicine_name: string; batch_no: string; expiry_date: string; charge_amount: number }

export const daysToExpiry = (ymd: string) => {
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  return Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400e3);
};
