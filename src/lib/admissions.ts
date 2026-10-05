import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const DISCHARGE_TYPES = ["regular", "lama", "referred", "death", "absconded"] as const;

export interface Admission {
  id: string; patient_id: string; bed_id: string | null; admitting_doctor_id: string; department_id: string | null;
  admitted_at: string; discharged_at: string | null; status: "admitted" | "discharged"; reason: string;
  discharge_type: string | null; discharge_note: string | null; deposit_amount: number;
  transfers: { from_bed_id: string; to_bed_id: string; at: string; reason: string }[];
}
export interface BedRequest {
  id: string; patient_id: string; source: "er" | "opd"; bed_class: string; priority: "routine" | "urgent";
  status: "pending" | "allotted" | "admitted" | "cancelled"; doctor_id: string | null; note: string; bed_id: string | null; created_at: string;
  patients?: { full_name: string; mrn: string; gender: string | null } | null;
}

export function useAdmission(id: string | null | undefined) {
  return useQuery({
    queryKey: ["admission", id], enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("admissions" as never)
        .select("*, patients(id, full_name, mrn, gender, dob, allergies)").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data as unknown as (Admission & { patients: { id: string; full_name: string; mrn: string; gender: string | null; dob: string | null; allergies: string[] } | null }) | null;
    },
  });
}

export function usePatientAdmissions(patientId: string | undefined) {
  return useQuery({
    queryKey: ["admissions", "patient", patientId], enabled: !!patientId,
    queryFn: async () => {
      const { data, error } = await supabase.from("admissions" as never).select("*").eq("patient_id", patientId!).order("admitted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Admission[];
    },
  });
}

export function useOpenBedRequests() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase.channel(`bed-requests-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bed_requests" }, () => qc.invalidateQueries({ queryKey: ["bed-requests"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
  return useQuery({
    queryKey: ["bed-requests"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bed_requests" as never)
        .select("*, patients(full_name, mrn, gender)").in("status", ["pending", "allotted"]).order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as BedRequest[];
    },
  });
}

/** Ward gender rule shared with the server: "any" wards take everyone; otherwise genders must match. */
export const genderOk = (wardGender: string, patientGender: string | null) => wardGender === "any" || wardGender === patientGender;

export const ADMISSION_INVALIDATE = [["beds"], ["ward-board"], ["bed-requests"], ["admissions"], ["admission"], ["patient-summary"]];
