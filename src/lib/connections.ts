import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Data types a patient can share with a connected doctor (mirrors PERM_KEYS in the connection functions and the tracker RLS policies). */
export const PERM_KEYS = ["profile", "conditions", "measurements", "symptoms", "medicines"] as const;
export type PermKey = (typeof PERM_KEYS)[number];

export interface Connection {
  id: string; doctor_id: string; patient_account_id: string; patient_id: string | null; patient_name: string | null;
  status: string; permissions: Partial<Record<PermKey, boolean>>; created_at: string; responded_at: string | null; revoked_at: string | null;
}

/** Live list of connections the caller can read (RLS: patient's own, or the doctor's). Refetches on any change. */
export function useConnections(key: string) {
  const qc = useQueryClient();
  const uid = useId();
  useEffect(() => {
    const ch = supabase.channel(`connections-${key}-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "connections" }, () => {
        qc.invalidateQueries({ queryKey: ["connections", key] });
        qc.invalidateQueries({ queryKey: ["conn-readings"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [key, uid, qc]);
  return useQuery({
    queryKey: ["connections", key],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.from("connections").select("*").in("status", ["requested", "active"]).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Connection[];
    },
  });
}
