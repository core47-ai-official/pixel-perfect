import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Frequency presets: label → doses per day (0 = as needed / once). */
export const FREQUENCIES = [
  { id: "1+0+0", perDay: 1 },
  { id: "0+0+1", perDay: 1 },
  { id: "1+0+1", perDay: 2 },
  { id: "1+1+1", perDay: 3 },
  { id: "1+1+1+1", perDay: 4 },
  { id: "OD", perDay: 1 },
  { id: "BD", perDay: 2 },
  { id: "TDS", perDay: 3 },
  { id: "QID", perDay: 4 },
  { id: "HS", perDay: 1 },
  { id: "SOS", perDay: 0 },
  { id: "STAT", perDay: 0 },
] as const;

/** Instruction presets, printed in English and Urdu. */
export const INSTRUCTIONS = [
  { id: "afterMeal", en: "After meal", ur: "کھانے کے بعد" },
  { id: "beforeMeal", en: "Before meal", ur: "کھانے سے پہلے" },
  { id: "withMeal", en: "With meal", ur: "کھانے کے ساتھ" },
  { id: "emptyStomach", en: "On an empty stomach", ur: "خالی پیٹ" },
  { id: "bedtime", en: "At bedtime", ur: "سونے سے پہلے" },
  { id: "whenNeeded", en: "Only when needed", ur: "صرف ضرورت کے وقت" },
] as const;

export const DURATIONS = [3, 5, 7, 10, 14, 30] as const;
const COUNTABLE = ["tablet", "capsule", "sachet", "suppository"];

/** Auto quantity: countable forms = dose × per-day × days; other forms = 1 pack. */
export function autoQuantity(form: string, dose: string, frequency: string, days: number | null): number {
  if (!COUNTABLE.includes(form)) return 1;
  const perDay = FREQUENCIES.find((f) => f.id === frequency)?.perDay ?? 1;
  const n = parseFloat(dose.replace(",", ".")) || 1;
  if (perDay === 0) return Math.ceil(n);
  return Math.max(1, Math.ceil(n * perDay * (days ?? 1)));
}

export interface RxItem {
  medicine_id: string;
  medicine_name: string;
  form: string;
  dose: string;
  frequency: string;
  route: string;
  duration_days: number | null;
  instructions_en: string;
  instructions_ur: string;
  quantity: number;
}
export interface RxWarning { kind: "allergy" | "duplicate" | "interaction"; severity: string; medicine_ids: string[]; message: string }
export interface Prescription {
  id: string; notes: string; warnings: RxWarning[]; warnings_acknowledged: boolean; acknowledged_at: string | null; updated_at: string;
  items: (RxItem & { id: string })[];
}

export function useVisitPrescription(visitId: string) {
  return useQuery({
    queryKey: ["prescription", visitId],
    queryFn: async (): Promise<Prescription | null> => {
      const { data, error } = await supabase.from("prescriptions")
        .select("id, notes, warnings, warnings_acknowledged, acknowledged_at, updated_at, prescription_items(id, medicine_id, medicine_name, dose, frequency, route, duration_days, instructions_en, instructions_ur, quantity, sort_order, medicines(form))")
        .eq("visit_id", visitId).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const items = [...(data.prescription_items ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => ({
          id: i.id, medicine_id: i.medicine_id, medicine_name: i.medicine_name, form: (i.medicines as { form: string } | null)?.form ?? "tablet",
          dose: i.dose, frequency: i.frequency, route: i.route, duration_days: i.duration_days,
          instructions_en: i.instructions_en, instructions_ur: i.instructions_ur, quantity: i.quantity,
        }));
      return { id: data.id, notes: data.notes, warnings: (data.warnings as unknown as RxWarning[]) ?? [], warnings_acknowledged: data.warnings_acknowledged, acknowledged_at: data.acknowledged_at, updated_at: data.updated_at, items };
    },
  });
}
