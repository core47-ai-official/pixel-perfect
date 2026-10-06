import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Mirrors checkMeasurement in edge-functions/log-measurement.ts and update-measurement.ts (server has the final say). */
export const MG_PER_MMOL = 18.016;
export type MType = "bp" | "glucose" | "weight" | "temp" | "pulse" | "spo2";
export const QUICK_TYPES: MType[] = ["bp", "glucose", "weight", "temp", "pulse", "spo2"];
export const M_CONTEXTS: Partial<Record<MType, string[]>> = { bp: ["sitting", "standing", "lying"], glucose: ["fasting", "before_meal", "after_meal", "random"] };
export const M_UNITS: Record<MType, string[]> = { bp: ["mmHg"], glucose: ["mg/dL", "mmol/L"], weight: ["kg"], temp: ["°C", "°F"], pulse: ["bpm"], spo2: ["%"] };

type Err = { key: string; params?: Record<string, string | number> };
const range = (label: string, lo: number, hi: number, unit: string): Err => ({ key: "meas.err.range", params: { label, lo, hi, unit } });

/** Returns a translatable error, or null when the reading is acceptable. `label` params are i18n keys. */
export function checkReading(type: MType, v1: number, v2: number | null, unit: string): Err | null {
  if (!Number.isFinite(v1)) return { key: "meas.err.number" };
  if (type === "bp") {
    if (v2 === null || !Number.isFinite(v2)) return { key: "meas.err.bothBp" };
    if (v1 < 50 || v1 > 260) return range("meas.sys", 50, 260, "mmHg");
    if (v2 < 30 || v2 > 160) return range("meas.dia", 30, 160, "mmHg");
    if (v2 >= v1) return { key: "meas.err.bpOrder" };
  } else if (type === "glucose") {
    const mg = unit === "mmol/L" ? v1 * MG_PER_MMOL : v1;
    if (mg < 20 || mg > 600) return unit === "mmol/L" ? range("meas.t.glucose", 1.1, 33.3, "mmol/L") : range("meas.t.glucose", 20, 600, "mg/dL");
  } else if (type === "weight") { if (v1 < 1 || v1 > 400) return range("meas.t.weight", 1, 400, "kg"); }
  else if (type === "temp") {
    const c = unit === "°F" ? (v1 - 32) * 5 / 9 : v1;
    if (c < 30 || c > 45) return unit === "°F" ? range("meas.t.temp", 86, 113, "°F") : range("meas.t.temp", 30, 45, "°C");
  } else if (type === "pulse") { if (v1 < 20 || v1 > 250) return range("meas.t.pulse", 20, 250, "bpm"); }
  else if (type === "spo2") { if (v1 < 50 || v1 > 100) return range("meas.t.spo2", 50, 100, "%"); }
  return null;
}

export interface Measurement {
  id: string; type: string; value_1: number; value_2: number | null; unit: string | null; context: string | null;
  measured_at: string; notes: string | null; original_value: number | null; original_unit: string | null;
}
export const useRecentMeasurements = () => useQuery({
  queryKey: ["measurements"],
  queryFn: async () => {
    const { data, error } = await supabase.from("measurements")
      .select("id, type, value_1, value_2, unit, context, measured_at, notes, original_value, original_unit")
      .order("measured_at", { ascending: false }).limit(20);
    if (error) throw error;
    return data as Measurement[];
  },
});

export const formatReading = (m: Pick<Measurement, "type" | "value_1" | "value_2" | "unit" | "original_value" | "original_unit">) =>
  m.type === "bp" ? `${Number(m.value_1)}/${Number(m.value_2)} mmHg`
    : m.original_unit ? `${Number(m.original_value)} ${m.original_unit}` : `${Number(m.value_1)} ${m.unit ?? ""}`.trim();
