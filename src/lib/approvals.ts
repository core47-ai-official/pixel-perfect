import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const APPROVAL_TYPES = ["discount", "waiver", "installment", "refund", "reversal"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];
export type ApprovalStatus = "pending" | "deciding" | "approved" | "rejected";
export interface Approval {
  id: string; type: ApprovalType; invoice_id: string; patient_id: string; payment_id: string | null;
  amount: number; percent: number | null; reason: string; details: Record<string, unknown>;
  requested_by: string; requested_by_name: string; status: ApprovalStatus;
  decided_by: string | null; decided_at: string | null; decision_note: string | null; created_at: string;
  patients?: { full_name: string; mrn: string } | null;
  invoices?: { invoice_no: string; total: number; balance: number } | null;
}
export const APPROVAL_TONE: Record<ApprovalStatus, "caution" | "ok" | "urgent" | "progress"> = {
  pending: "caution", deciding: "progress", approved: "ok", rejected: "urgent",
};

export function useApprovals(filter: { status?: "pending" | "decided"; mine?: string | null; invoiceId?: string | null }) {
  const qc = useQueryClient();
  const uid = useId();
  useEffect(() => {
    const ch = supabase.channel(`approvals-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "approvals" }, () => void qc.invalidateQueries({ queryKey: ["approvals"] }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc, uid]);
  return useQuery({
    queryKey: ["approvals", filter],
    queryFn: async () => {
      let q = supabase.from("approvals" as never).select("*, patients(full_name, mrn), invoices(invoice_no, total, balance)");
      if (filter.status === "pending") q = q.in("status", ["pending", "deciding"]);
      if (filter.status === "decided") q = q.in("status", ["approved", "rejected"]);
      if (filter.mine) q = q.eq("requested_by", filter.mine);
      if (filter.invoiceId) q = q.eq("invoice_id", filter.invoiceId);
      const { data, error } = await q.order("created_at", { ascending: filter.status === "pending" }).limit(200);
      if (error) throw error;
      return data as unknown as Approval[];
    },
  });
}
