import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const PROVINCES = ["punjab", "sindh", "kpk", "balochistan", "islamabad", "gb", "ajk"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const GENDERS = ["male", "female", "other"] as const;
export const PREGNANCY = ["not_applicable", "not_pregnant", "pregnant", "unknown"] as const;

export interface Patient {
  id: string; mrn: string; cnic: string | null; b_form: string | null; full_name: string;
  father_or_husband_name: string | null; dob: string | null; gender: string | null; phone: string | null;
  email: string | null; guardian_name: string | null; guardian_phone: string | null; province: string | null;
  district: string | null; tehsil: string | null; address: string | null; blood_group: string | null;
  allergies: string[]; chronic_conditions: string[]; pregnancy_status: string | null; print_language: string | null;
  is_unknown: boolean; merged_into: string | null; created_at: string;
}
export type PatientInput = Omit<Patient, "id" | "mrn" | "merged_into" | "created_at">;
export interface DuplicateMatch {
  id: string; mrn: string; full_name: string; father_or_husband_name: string | null; dob: string | null;
  gender: string | null; phone: string | null; cnic: string | null; district: string | null;
  reasons: ("cnic" | "phone" | "name_dob")[];
}

export const PATIENT_ROLES_EDIT = ["receptionist", "er_officer", "admin", "super_admin"] as const;

/** Whole years from a YYYY-MM-DD date of birth. */
export function ageFrom(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

export function usePatient(id: string) {
  return useQuery({
    queryKey: ["patients", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("patients").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Patient | null;
    },
  });
}
