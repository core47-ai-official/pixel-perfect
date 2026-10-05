import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const REFERRAL_URGENCY = ["routine", "urgent", "emergency"] as const;
export const REFERRAL_STATUS = ["sent", "accepted", "rejected", "completed"] as const;
export const REFERRAL_NEXT: Record<string, string[]> = { sent: ["accepted", "rejected"], accepted: ["completed"] };
export const REFERRAL_TONE: Record<string, "info" | "ok" | "urgent" | "inactive"> = { sent: "info", accepted: "ok", rejected: "urgent", completed: "inactive" };
export const REFERRAL_WRITE_ROLES = ["super_admin", "admin", "dept_head", "doctor", "er_officer"];
export const REFERRAL_INVALIDATE = [["referrals"], ["er-cases"], ["beds"], ["patient-summary"]];

export interface Referral {
  id: string; patient_id: string; direction: "in" | "out"; from_facility: string; to_facility: string; reason: string; summary: string | null;
  urgency: string; status: string; status_note: string | null; status_at: string | null; contact_person: string | null; contact_phone: string | null;
  referred_by_name: string | null; created_at: string; emergency_case_id: string | null;
  patients: { full_name: string; mrn: string; dob: string | null; gender: string | null; print_language: string | null } | null;
}

export function useReferrals(direction: "in" | "out") {
  return useQuery({
    queryKey: ["referrals", direction],
    queryFn: async () => {
      const { data, error } = await supabase.from("referrals" as never)
        .select("*, patients(full_name, mrn, dob, gender, print_language)").eq("direction", direction).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Referral[];
    },
  });
}

export async function fetchReferral(id: string) {
  const { data, error } = await supabase.from("referrals" as never).select("*, patients(full_name, mrn, dob, gender, print_language)").eq("id", id).single();
  if (error) throw error;
  return data as unknown as Referral;
}
