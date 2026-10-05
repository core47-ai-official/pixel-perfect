import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const MED_FORMS = ["tablet", "capsule", "syrup", "suspension", "injection", "infusion", "drops", "cream", "ointment", "inhaler", "suppository", "sachet", "other"] as const;
export const MED_ROUTES = ["oral", "iv", "im", "sc", "topical", "inhalation", "ophthalmic", "otic", "nasal", "rectal", "vaginal", "sublingual", "other"] as const;
export const SEVERITIES = ["minor", "moderate", "major", "contraindicated"] as const;

export interface Medicine {
  id: string;
  generic_name: string;
  brand_name: string | null;
  strength: string | null;
  form: string;
  route: string;
  unit_price: number;
  drap_reg_no: string | null;
  is_active: boolean;
  interaction_group: string[];
}
export interface Interaction { id: string; group_a: string; group_b: string; severity: string; note: string }

export function useMedicines() {
  return useQuery({
    queryKey: ["medicines"],
    queryFn: async (): Promise<Medicine[]> => {
      const { data, error } = await supabase.from("medicines")
        .select("id, generic_name, brand_name, strength, form, route, unit_price, drap_reg_no, is_active, interaction_group")
        .order("generic_name").limit(5000);
      if (error) throw error;
      return (data ?? []).map((m) => ({ ...m, unit_price: Number(m.unit_price) }));
    },
  });
}

export function useInteractions() {
  return useQuery({
    queryKey: ["drug-interactions"],
    queryFn: async (): Promise<Interaction[]> => {
      const { data, error } = await supabase.from("drug_interactions").select("id, group_a, group_b, severity, note").order("group_a");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(f); out.push(row); row = []; f = "";
    } else f += ch;
  }
  if (f || row.length) { row.push(f); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim()));
}

export type CsvMedicine = { generic_name?: string; brand_name?: string; strength?: string; form?: string; route?: string; unit_price?: string; drap_reg_no?: string; interaction_group?: string };
export const CSV_COLUMNS = ["generic_name", "brand_name", "strength", "form", "route", "unit_price", "drap_reg_no", "interaction_group"] as const;

/** Mirrors the server's validation so the preview shows the same error rows. */
export function validateCsvRow(r: CsvMedicine): string | null {
  if (!r.generic_name?.trim()) return "generic";
  const form = (r.form || "tablet").trim().toLowerCase();
  if (!(MED_FORMS as readonly string[]).includes(form)) return "form";
  const route = (r.route || "oral").trim().toLowerCase();
  if (!(MED_ROUTES as readonly string[]).includes(route)) return "route";
  const p = Number((r.unit_price || "0").replace(/,/g, ""));
  if (!Number.isFinite(p) || p < 0) return "price";
  return null;
}
