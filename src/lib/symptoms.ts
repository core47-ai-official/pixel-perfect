import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Common symptoms (id → stored English name). Mirrors nothing server-side: any name is accepted. */
export const COMMON_SYMPTOMS = [
  ["headache", "Headache"], ["fever", "Fever"], ["cough", "Cough"], ["sore_throat", "Sore throat"], ["runny_nose", "Runny nose"],
  ["breathless", "Shortness of breath"], ["chest_pain", "Chest pain"], ["dizziness", "Dizziness"], ["nausea", "Nausea"],
  ["vomiting", "Vomiting"], ["diarrhoea", "Diarrhoea"], ["stomach_pain", "Stomach pain"], ["back_pain", "Back pain"],
  ["joint_pain", "Joint pain"], ["fatigue", "Tiredness"], ["rash", "Skin rash"], ["itching", "Itching"], ["palpitations", "Palpitations"],
  ["burning_urine", "Burning urine"], ["poor_sleep", "Poor sleep"], ["anxiety", "Anxiety"], ["swelling", "Swelling"],
] as const;
/** Must match TRIGGERS in checkSymptom (log-symptom / update-symptom). */
export const SYMPTOM_TRIGGERS = ["food", "stress", "exercise", "weather", "medicine"] as const;
export const ATTACH_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const ATTACH_MAX = 5 * 1024 * 1024;

export interface SymptomLog {
  id: string; symptom: string; severity: number; started_at: string; ended_at: string | null; triggers: string[];
  related: string | null; notes: string | null; attachment_url: string | null;
}
export const useRecentSymptoms = () => useQuery({
  queryKey: ["symptoms"],
  queryFn: async () => {
    const { data, error } = await supabase.from("symptom_logs").select("id, symptom, severity, started_at, ended_at, triggers, related, notes, attachment_url")
      .order("started_at", { ascending: false }).limit(20);
    if (error) throw error;
    return data as SymptomLog[];
  },
});

/** Opens a private attachment with a 60-second link; storage rules only allow the owner. */
export async function openAttachment(path: string) {
  const { data, error } = await supabase.storage.from("tracker").createSignedUrl(path, 60);
  if (error || !data) throw error ?? new Error("no url");
  window.open(data.signedUrl, "_blank", "noopener");
}

export const fileToBase64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ""));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(f);
});
