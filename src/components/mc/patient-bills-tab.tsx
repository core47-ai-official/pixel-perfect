import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, Receipt } from "lucide-react";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { EmptyState } from "@/components/mc/empty-state";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { Banner } from "@/components/mc/banner";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPkr } from "@/lib/patient-summary";
import { cn } from "@/lib/utils";
import { EntitlementsSection, InvoicePayer } from "@/components/mc/entitlements";

export interface InvoiceLine { id: string; description: string; qty: number; rate: number; amount: number; source_type: string; created_at: string }
export interface Invoice {
  id: string; invoice_no: string; payer_type: string; patient_id?: string; entitlement_id?: string | null; total: number; discount: number; paid: number; balance: number;
  status: "open" | "partly_paid" | "paid" | "waived" | "closed"; admission_id: string | null; created_at: string; invoice_lines: InvoiceLine[];
}
const STATUS_TONE: Record<Invoice["status"], "warning" | "caution" | "ok" | "inactive"> = { open: "warning", partly_paid: "caution", paid: "ok", waived: "inactive", closed: "inactive" };

export function usePatientInvoices(patientId: string) {
  return useQuery({
    queryKey: ["invoices", "patient", patientId],
    queryFn: () => callEdgeFunction<Invoice[]>("get-invoice", { patient_id: patientId }),
    retry: false,
  });
}

export function PatientBillsTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const q = usePatientInvoices(patientId);
  const [openId, setOpenId] = useState<string | null>(null);
  const ent = <EntitlementsSection patientId={patientId} />;
  if (q.isLoading) return <div className="space-y-3">{ent}<Skeleton className="h-40" /></div>;
  if (q.error) return <Banner tone="warning" title={t("bill.unavailable")}>{(q.error as { message?: string }).message}</Banner>;
  const list = q.data ?? [];
  if (!list.length) return <div className="space-y-3">{ent}<EmptyState icon={Receipt} title={t("bill.none")} /></div>;
  const current = openId ?? list.find((i) => i.status === "open" || i.status === "partly_paid")?.id ?? list[0]?.id;

  return (
    <div className="space-y-3">
      {ent}
      {list.map((inv) => {
        const expanded = inv.id === current;
        return (
          <div key={inv.id} className="rounded-staff border bg-card">
            <button className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start" onClick={() => setOpenId(expanded ? "" : inv.id)} aria-expanded={expanded}>
              <Ltr className="font-mono font-semibold">{inv.invoice_no}</Ltr>
              <span className="text-xs text-muted-foreground">{t(inv.admission_id ? "bill.ipd" : "bill.opd")} · <Ltr>{new Date(inv.created_at).toLocaleDateString("en-PK")}</Ltr></span>
              <StatusChip status={STATUS_TONE[inv.status]}>{t(`bill.statuses.${inv.status}`)}</StatusChip>
              <span className="ms-auto text-sm">{t("bill.balance")} <Ltr className={cn("tnum font-semibold", Number(inv.balance) > 0 && "text-urgent")}>{formatPkr(Number(inv.balance))}</Ltr></span>
              <ChevronDown className={cn("size-4 transition", expanded && "rotate-180")} />
            </button>
            {expanded && (
              <div className="border-t px-4 py-3">
                <InvoicePayer invoice={inv} />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-xs text-muted-foreground">
                      <th className="py-2 text-start font-medium">{t("bill.item")}</th>
                      <th className="py-2 text-end font-medium">{t("bill.qty")}</th>
                      <th className="py-2 text-end font-medium">{t("bill.rate")}</th>
                      <th className="py-2 text-end font-medium">{t("bill.amount")}</th>
                    </tr></thead>
                    <tbody>
                      {inv.invoice_lines.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-muted-foreground">{t("bill.noLines")}</td></tr>}
                      {inv.invoice_lines.map((l) => (
                        <tr key={l.id} className="border-b last:border-0">
                          <td className="py-2"><Ltr>{l.description}</Ltr><span className="ms-2 text-xs text-muted-foreground">{t(`bill.sources.${l.source_type}`, "")}</span></td>
                          <td className="py-2 text-end"><Ltr className="tnum">{Number(l.qty)}</Ltr></td>
                          <td className="py-2 text-end"><Ltr className="tnum">{formatPkr(Number(l.rate))}</Ltr></td>
                          <td className="py-2 text-end"><Ltr className="tnum">{formatPkr(Number(l.amount))}</Ltr></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <dl className="ms-auto mt-3 grid max-w-xs grid-cols-2 gap-y-1 text-sm">
                  <dt>{t("bill.total")}</dt><dd className="text-end"><Ltr className="tnum">{formatPkr(Number(inv.total))}</Ltr></dd>
                  <dt>{t("bill.discount")}</dt><dd className="text-end"><Ltr className="tnum">− {formatPkr(Number(inv.discount))}</Ltr></dd>
                  <dt>{t("bill.paid")}</dt><dd className="text-end"><Ltr className="tnum">− {formatPkr(Number(inv.paid))}</Ltr></dd>
                  <dt className="border-t pt-1 font-semibold">{t("bill.balance")}</dt>
                  <dd className={cn("border-t pt-1 text-end font-semibold", Number(inv.balance) > 0 && "text-urgent")}><Ltr className="tnum">{formatPkr(Number(inv.balance))}</Ltr></dd>
                </dl>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
