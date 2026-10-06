import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Condition checklist for onboarding; the stored name is the English label so doctors read one language. */
export const TRACKER_CONDITIONS = [
  ["diabetes_t2", "Diabetes type 2"], ["diabetes_t1", "Diabetes type 1"], ["hypertension", "High blood pressure"],
  ["heart", "Heart disease"], ["cholesterol", "High cholesterol"], ["stroke", "Previous stroke"], ["asthma", "Asthma"],
  ["copd", "COPD"], ["tb", "Tuberculosis"], ["hep_b", "Hepatitis B"], ["hep_c", "Hepatitis C"], ["kidney", "Kidney disease"],
  ["liver", "Liver disease"], ["thyroid", "Thyroid disorder"], ["anaemia", "Anaemia"], ["thalassaemia", "Thalassaemia"],
  ["epilepsy", "Epilepsy"], ["migraine", "Migraine"], ["arthritis", "Arthritis"], ["depression", "Depression or anxiety"],
  ["pcos", "PCOS"], ["cancer", "Cancer"], ["pregnancy", "Pregnancy"],
] as const;

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

export interface TrackerProfile {
  id: string; dob: string | null; gender: string | null; height_cm: number | null; weight_kg: number | null; blood_group: string | null;
  emergency_contact: { name?: string; relation?: string; phone?: string }; health_status: string; onboarding_done: boolean;
}

export const trackerProfileQuery = queryOptions({
  queryKey: ["tracker-profile"],
  queryFn: async () => {
    const { data, error } = await supabase.from("tracker_profiles").select("id, dob, gender, height_cm, weight_kg, blood_group, emergency_contact, health_status, onboarding_done").maybeSingle();
    if (error) throw error;
    return data as TrackerProfile | null;
  },
});
export const useTrackerProfile = () => useQuery(trackerProfileQuery);

export const useTrackerLists = () => useQuery({
  queryKey: ["tracker-lists"],
  queryFn: async () => {
    const [c, m] = await Promise.all([
      supabase.from("tracker_conditions").select("id, name, status").order("name"),
      supabase.from("medication_schedules").select("id, name, dose, active").eq("active", true).order("name"),
    ]);
    if (c.error) throw c.error;
    if (m.error) throw m.error;
    return { conditions: c.data ?? [], medicines: m.data ?? [] };
  },
});

/** Hospital record fields used to pre-fill onboarding when the account is linked (RLS: own patient row only). */
export const useLinkedPatientDetails = () => useQuery({
  queryKey: ["tracker-prefill"],
  queryFn: async () => {
    const { data } = await supabase.from("patients").select("dob, gender, blood_group, guardian_name, guardian_phone, chronic_conditions").maybeSingle();
    return data as { dob: string | null; gender: string | null; blood_group: string | null; guardian_name: string | null; guardian_phone: string | null; chronic_conditions: unknown } | null;
  },
});

export const bmi = (h?: number | null, w?: number | null) => (h && w ? w / ((h / 100) ** 2) : null);
