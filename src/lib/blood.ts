import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Status } from "@/components/mc/status-chip";

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const COMPONENTS = ["whole", "prbc", "ffp", "platelets"] as const;
export const URGENCIES = ["routine", "urgent", "emergency"] as const;
export type Component = (typeof COMPONENTS)[number];

export interface BloodUnit {
  id: string; unit_no: string; blood_group: string; component: Component; volume_ml: number | null;
  collected_at: string; expires_at: string; status: "available" | "reserved" | "issued" | "discarded";
  donor_name: string | null; reserved_for_request_id: string | null; issued_to_patient_id: string | null; issued_at: string | null; discard_reason: string | null;
}
export interface BloodRequest {
  id: string; patient_id: string; blood_group: string; component: Component; units: number; urgency: string; reason: string | null;
  status: string; crossmatch_result: string | null; crossmatch_note: string | null; reserved_unit_ids: string[]; units_issued: number; created_at: string;
  emergency_case_id: string | null;
  patients: { full_name: string; mrn: string } | null;
}

export const BLOOD_INVALIDATE = [["blood"]];

/** Same donor → recipient rules the server uses (issue/crossmatch re-check them). */
export function compatible(component: string, donor: string, recipient: string) {
  const dAbo = donor.replace(/[+-]/, ""), rAbo = recipient.replace(/[+-]/, "");
  const dNeg = donor.endsWith("-"), rNeg = recipient.endsWith("-");
  if (component === "ffp") return ({ O: ["O", "A", "B", "AB"], A: ["A", "AB"], B: ["B", "AB"], AB: ["AB"] } as Record<string, string[]>)[rAbo]?.includes(dAbo) ?? false;
  if (component === "platelets") return !(rNeg && !dNeg);
  const red: Record<string, string[]> = { O: ["O"], A: ["A", "O"], B: ["B", "O"], AB: ["AB", "A", "B", "O"] };
  return (red[rAbo] ?? []).includes(dAbo) && !(rNeg && !dNeg);
}

/** Expiry colours for short-lived blood: red within 2 days (or expired), amber within 7. */
export const hoursLeft = (iso: string) => (new Date(iso).getTime() - Date.now()) / 3600e3;
export const bloodExpiryTone = (iso: string): Status => { const h = hoursLeft(iso); return h <= 48 ? "urgent" : h <= 168 ? "warning" : "ok"; };

export const URGENCY_TONE: Record<string, Status> = { emergency: "urgent", urgent: "warning", routine: "inactive" };
export const REQ_STATUS_TONE: Record<string, Status> = { requested: "caution", crossmatched: "progress", incompatible: "urgent", partly_issued: "progress", issued: "ok", cancelled: "inactive" };

export const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function useBloodRealtime() {
  const qc = useQueryClient();
  const id = useId();
  useEffect(() => {
    const ch = supabase.channel(`blood-live-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "blood_units" }, () => void qc.invalidateQueries({ queryKey: ["blood"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "blood_requests" }, () => void qc.invalidateQueries({ queryKey: ["blood"] }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc, id]);
}

/** Units not yet issued/discarded, plus the last 50 issued/discarded for history. */
export function useBloodUnits() {
  useBloodRealtime();
  return useQuery({
    queryKey: ["blood", "units"],
    queryFn: async () => {
      const { data, error } = await supabase.from("blood_units" as never).select("*").in("status", ["available", "reserved"]).order("expires_at").limit(1000);
      if (error) throw error;
      const { data: done } = await supabase.from("blood_units" as never).select("*").in("status", ["issued", "discarded"]).order("updated_at", { ascending: false }).limit(50);
      return { stock: (data ?? []) as unknown as BloodUnit[], history: (done ?? []) as unknown as BloodUnit[] };
    },
  });
}

export function useBloodRequests() {
  return useQuery({
    queryKey: ["blood", "requests"],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86400e3).toISOString();
      const { data, error } = await supabase.from("blood_requests" as never).select("*, patients(full_name, mrn)")
        .or(`status.in.(requested,crossmatched,incompatible,partly_issued),created_at.gte.${since}`).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as BloodRequest[];
    },
  });
}
