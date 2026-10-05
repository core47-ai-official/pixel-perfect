import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/hooks/use-edge-function";

export interface CashierShift {
  id: string; cashier_id: string; cashier_name: string; opened_at: string; opening_cash: number;
  closed_at: string | null; expected_cash: number | null; counted_cash: number | null; difference: number | null;
  note: string | null; status: "open" | "closed";
}
export interface ShiftTotals {
  payments: number; payment_count: number; refunds: number; refund_count: number;
  reversals: number; reversal_count: number; deposits: number; deposit_count: number; expected_cash: number;
}
export interface ShiftSummary { shift: CashierShift; totals: ShiftTotals }

export const SHIFT_INVALIDATE = [["shift"], ["shifts"]];

/** The caller's open shift with live totals, or null. */
export function useMyOpenShift(enabled = true) {
  return useQuery({
    queryKey: ["shift", "mine"], enabled, retry: false, refetchInterval: 30_000,
    queryFn: () => callEdgeFunction<ShiftSummary | null>("get-shift-summary", {}),
  });
}

export function useShiftHistory() {
  return useQuery({
    queryKey: ["shifts", "history"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cashier_shifts" as never).select("*").order("opened_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data as unknown as CashierShift[];
    },
  });
}

export async function getShiftSummary(shiftId: string) {
  return callEdgeFunction<ShiftSummary | null>("get-shift-summary", { shift_id: shiftId });
}
