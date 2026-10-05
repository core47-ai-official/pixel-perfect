import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LabTest {
  id: string; code: string; name: string; category: string; sample_type: string | null;
  price: number; reference_range: string | null; turnaround_hours: number; is_active: boolean;
}
export interface LabOrder {
  id: string; visit_id: string | null; test_id: string; priority: string; status: string;
  result: string | null; result_flag: string | null; notes: string; created_at: string; resulted_at: string | null;
  test: { code: string; name: string; category: string; reference_range: string | null } | null;
}

export const ORDER_STATUSES = ["ordered", "collected", "in_progress", "resulted", "verified", "cancelled"] as const;
export const STATUS_TONE: Record<string, "inactive" | "progress" | "ok" | "caution" | "warning" | "urgent"> = {
  ordered: "inactive", collected: "progress", in_progress: "progress", resulted: "caution", verified: "ok", cancelled: "inactive",
};

/** Common panels: one click orders every code that exists in the hospital's catalogue. */
export const LAB_PANELS = [
  { id: "cbc", codes: ["CBC"] },
  { id: "lft", codes: ["LFT"] },
  { id: "rft", codes: ["RFT"] },
  { id: "dengue", codes: ["NS1", "CBC"] },
  { id: "fever", codes: ["CBC", "MP", "TYPHIDOT", "CRP"] },
  { id: "diabetes", codes: ["FBS", "HBA1C", "LIPID"] },
] as const;

export function useLabTests() {
  return useQuery({
    queryKey: ["lab-tests"],
    queryFn: async (): Promise<LabTest[]> => {
      const { data, error } = await supabase.from("lab_tests")
        .select("id, code, name, category, sample_type, price, reference_range, turnaround_hours, is_active").order("code");
      if (error) throw error;
      return (data ?? []).map((t) => ({ ...t, price: Number(t.price) }));
    },
  });
}

const ORDER_SELECT = "id, visit_id, test_id, priority, status, result, result_flag, notes, created_at, resulted_at, lab_tests(code, name, category, reference_range)";
type RawOrder = Omit<LabOrder, "test"> & { lab_tests: LabOrder["test"] };
const mapOrder = ({ lab_tests, ...o }: RawOrder): LabOrder => ({ ...o, test: lab_tests });

export function useVisitOrders(visitId: string) {
  return useQuery({
    queryKey: ["orders", "visit", visitId],
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("visit_id", visitId).order("created_at");
      if (error) throw error;
      return ((data ?? []) as unknown as RawOrder[]).map(mapOrder);
    },
  });
}

export function usePatientOrders(patientId: string) {
  return useQuery({
    queryKey: ["orders", "patient", patientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("patient_id", patientId).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return ((data ?? []) as unknown as RawOrder[]).map(mapOrder);
    },
  });
}
