import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/hooks/use-edge-function";

export interface Installment { due_date: string; amount: number; paid: number }
export interface InstallmentPlan {
  id: string; invoice_id: string; total: number; schedule: Installment[]; status: "active" | "completed" | "cancelled"; approved_at: string | null;
}
export interface Clearance {
  cleared: boolean; reason: string; balance_due: number;
  bills: { invoice_id: string; invoice_no: string; balance: number; covered_by: "paid" | "waiver" | "installment" | null }[];
}

/** Today's date in Pakistan time (YYYY-MM-DD). */
export const todayPk = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

/** Splits an amount into equal whole-rupee installments; any remainder goes on the last one. */
export function splitSchedule(total: number, n: number, firstDue: string, everyDays: number) {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => ({
    due_date: addDays(firstDue, i * everyDays),
    amount: i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base,
  }));
}

export function useInvoicePlan(invoiceId: string | null) {
  return useQuery({
    queryKey: ["installment-plan", invoiceId], enabled: !!invoiceId,
    queryFn: async () => {
      const { data, error } = await supabase.from("installment_plans" as never).select("*").eq("invoice_id", invoiceId!)
        .in("status", ["active", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as unknown as InstallmentPlan | null;
    },
  });
}

export function useClearance(admissionId: string | null) {
  return useQuery({
    queryKey: ["discharge-clearance", admissionId], enabled: !!admissionId, retry: false,
    queryFn: () => callEdgeFunction<Clearance>("get-discharge-clearance", { admission_id: admissionId }),
  });
}
