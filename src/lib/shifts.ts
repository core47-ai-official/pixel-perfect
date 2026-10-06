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
    queryFn: async () => normalizeSummary(await callEdgeFunction<unknown>("get-shift-summary", {})),
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
  return normalizeSummary(await callEdgeFunction<unknown>("get-shift-summary", { shift_id: shiftId }));
}

/** Accepts any server reply shape; returns a complete summary (numbers coerced) or null, so the page never crashes on odd data. */
export function normalizeSummary(raw: unknown): ShiftSummary | null {
  const r = raw as { shift?: Record<string, unknown>; totals?: Record<string, unknown> } | null;
  if (!r || typeof r !== "object" || !r.shift || typeof r.shift !== "object") return null;
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const nn = (v: unknown) => (v == null ? null : n(v));
  const t = r.totals ?? {};
  const sh = r.shift;
  return {
    ...(r as object),
    shift: { ...sh, opening_cash: n(sh.opening_cash), expected_cash: nn(sh.expected_cash), counted_cash: nn(sh.counted_cash), difference: nn(sh.difference), cashier_name: String(sh.cashier_name ?? "") },
    totals: {
      ...t,
      payments: n(t.payments), deposits: n(t.deposits), refunds: n(t.refunds), reversals: n(t.reversals),
      payment_count: n(t.payment_count), deposit_count: n(t.deposit_count), refund_count: n(t.refund_count), reversal_count: n(t.reversal_count),
      expected_cash: t.expected_cash != null ? n(t.expected_cash) : n(sh.opening_cash) + n(t.payments) + n(t.deposits) - n(t.refunds) - n(t.reversals),
    },
  } as unknown as ShiftSummary;
}
