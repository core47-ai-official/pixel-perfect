import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Visit {
  id: string; hospital_id: string; patient_id: string; doctor_id: string; appointment_id: string | null;
  type: "opd" | "er" | "ipd"; chief_complaint: string; history: string; examination: string; plan: string;
  template: string | null; status: "draft" | "completed"; completed_at: string | null; created_at: string; updated_at: string;
}
export interface Vitals {
  id: string; patient_id: string; visit_id: string | null; bp_sys: number | null; bp_dia: number | null; pulse: number | null;
  temp_c: number | null; spo2: number | null; weight_kg: number | null; height_cm: number | null; rr: number | null; recorded_at: string;
}
export interface Addendum { id: string; visit_id: string; author_name: string; body: string; created_at: string }

// Clinical tables are new; cast through unknown until the generated types catch up.
const from = (t: string) => (supabase as unknown as { from: (t: string) => any }).from(t); // eslint-disable-line @typescript-eslint/no-explicit-any

export function useVisit(id: string) {
  return useQuery({
    queryKey: ["visits", "one", id],
    queryFn: async () => {
      const { data, error } = await from("visits").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Visit | null;
    },
  });
}

export function usePatientVisits(patientId: string | undefined) {
  return useQuery({
    queryKey: ["visits", "patient", patientId], enabled: !!patientId,
    queryFn: async () => {
      const { data, error } = await from("visits").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data as Visit[];
    },
  });
}

export function useMyDraftVisits(doctorId: string | undefined) {
  return useQuery({
    queryKey: ["visits", "drafts", doctorId], enabled: !!doctorId,
    queryFn: async () => {
      const { data, error } = await from("visits").select("*, patients(full_name, mrn)").eq("doctor_id", doctorId).eq("status", "draft")
        .order("updated_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data as (Visit & { patients: { full_name: string; mrn: string } | null })[];
    },
  });
}

export function useVitals(patientId: string | undefined) {
  return useQuery({
    queryKey: ["vitals", patientId], enabled: !!patientId,
    queryFn: async () => {
      const { data, error } = await from("vitals").select("*").eq("patient_id", patientId).order("recorded_at", { ascending: false }).limit(10);
      if (error) throw error;
      return data as Vitals[];
    },
  });
}

export function useAddenda(visitId: string) {
  return useQuery({
    queryKey: ["visit-addenda", visitId],
    queryFn: async () => {
      const { data, error } = await from("visit_addenda").select("*").eq("visit_id", visitId).order("created_at");
      if (error) throw error;
      return data as Addendum[];
    },
  });
}
