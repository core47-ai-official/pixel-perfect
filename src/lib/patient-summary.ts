import { useQuery } from "@tanstack/react-query";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import type { Patient } from "@/lib/patients";

export interface PatientSummary {
  patient: Patient;
  active_admission: { id: string; admitted_at?: string; ward?: string; bed?: string } | null;
  recent_visits: { id: string; visit_date?: string; type?: string; status?: string }[];
  open_bills: { id: string; bill_no?: string; total?: number; paid?: number; balance?: number; status?: string; created_at?: string }[] | null;
  balance_due: number | null;
  payer_type: string;
}

export function usePatientSummary(patientId: string) {
  return useQuery({
    queryKey: ["patients", patientId, "summary"],
    queryFn: () => callEdgeFunction<PatientSummary>("get-patient-summary", { patient_id: patientId }),
    retry: false,
  });
}

export const formatPkr = (n: number) => `Rs ${Number(n).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
