import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import type { Invoice } from "@/components/mc/patient-bills-tab";

export type PaymentKind = "payment" | "refund" | "reversal" | "deposit_applied";
export interface Payment {
  id: string; invoice_id: string; patient_id: string; receipt_no: string; kind: PaymentKind; amount: number;
  tendered: number | null; reason: string | null; deposit_id: string | null; created_at: string;
  reverses_id: string | null; reversed_by_id: string | null; reversal_requested_at: string | null; reversal_reason: string | null;
}
export interface Deposit {
  id: string; patient_id: string; admission_id: string | null; amount: number; applied_amount: number;
  receipt_no: string; note: string; created_at: string;
}
export interface SearchPatient {
  id: string; mrn: string; full_name: string; age: number | null; gender: string | null; phone: string | null; print_language: string | null;
}

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const CASH_ROLES = ["super_admin", "admin", "cashier"] as const;

export function useBillingInvoices(patientId: string | null) {
  return useQuery({
    queryKey: ["invoices", "patient", patientId], enabled: !!patientId, retry: false,
    queryFn: () => callEdgeFunction<Invoice[]>("get-invoice", { patient_id: patientId }),
  });
}

export function useInvoicePayments(invoiceId: string | null) {
  return useQuery({
    queryKey: ["payments", invoiceId], enabled: !!invoiceId,
    queryFn: async () => {
      const { data, error } = await supabase.from("payments" as never).select("*").eq("invoice_id", invoiceId!).order("created_at");
      if (error) throw error;
      return data as unknown as Payment[];
    },
  });
}

export function usePatientDeposits(patientId: string | null) {
  return useQuery({
    queryKey: ["deposits", patientId], enabled: !!patientId,
    queryFn: async () => {
      const { data, error } = await supabase.from("deposits" as never).select("*").eq("patient_id", patientId!).order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Deposit[];
    },
  });
}

export function usePendingReversals(enabled: boolean) {
  return useQuery({
    queryKey: ["payments", "pending-reversals"], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("payments" as never)
        .select("*, patients(full_name, mrn), invoices(invoice_no)")
        .not("reversal_requested_at", "is", null).is("reversed_by_id", null).order("reversal_requested_at");
      if (error) throw error;
      return data as unknown as (Payment & { patients: { full_name: string; mrn: string } | null; invoices: { invoice_no: string } | null })[];
    },
  });
}

export const CASH_INVALIDATE = [["invoices"], ["payments"], ["deposits"], ["patient-summary"]];
