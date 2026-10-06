import { useQuery } from "@tanstack/react-query";
import { Ltr } from "@/components/mc/ltr";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";

interface Issued { code?: string; expires_at?: string; already_linked?: boolean }

/** Issues (once per open print preview) a 6-digit patient-portal linking code; null when not allowed or already linked. */
export function usePortalCode(patientId: string | null | undefined, open: boolean) {
  const { hasRole } = useMyContext();
  const allowed = hasRole("receptionist", "admin", "super_admin", "doctor", "nurse");
  const q = useQuery({
    queryKey: ["portal-code", patientId],
    enabled: open && allowed && !!patientId,
    staleTime: 10 * 60_000, retry: false,
    queryFn: () => callEdgeFunction<Issued>("issue-linking-code", { patient_id: patientId }),
  });
  return q.data?.code ? q.data : null;
}

/** Printed block: how to link the patient app, with the code and its expiry. */
export function PortalCodeBlock({ pt, issued }: { pt: (k: string) => string; issued: Issued | null }) {
  if (!issued?.code) return null;
  const d = new Date(issued.expires_at ?? "");
  const exp = Number.isNaN(d.getTime()) ? "" : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  return (
    <div className="mc-rule border-t pt-1 text-center text-xs">
      <p>{pt("portal.print.line")}</p>
      <p className="text-lg font-bold tracking-widest"><Ltr>{issued.code}</Ltr></p>
      <p>{pt("portal.print.valid")} <Ltr>{exp}</Ltr></p>
    </div>
  );
}
