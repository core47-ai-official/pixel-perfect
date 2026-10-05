import { useTranslation } from "react-i18next";
import { FlaskConical } from "lucide-react";
import { EmptyState } from "@/components/mc/empty-state";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_TONE, usePatientOrders } from "@/lib/lab";
import { cn } from "@/lib/utils";

const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/** Patient profile → Lab tab: every order with status and, once available, the result. */
export function PatientLabTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const orders = usePatientOrders(patientId);
  if (orders.isLoading) return <Skeleton className="h-40" />;
  if (!orders.data?.length) return <EmptyState icon={FlaskConical} title={t("ptab.empty.lab")} description={t("lab.noneYet")} />;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-start">
          <tr>
            <th className="p-2 text-start">{t("lab.date")}</th><th className="p-2 text-start">{t("lab.test")}</th>
            <th className="p-2 text-start">{t("lab.result")}</th><th className="p-2 text-start">{t("lab.range")}</th><th className="p-2 text-start">{t("lab.statusLabel")}</th>
          </tr>
        </thead>
        <tbody>
          {orders.data.map((o) => {
            const abnormal = o.result_flag && o.result_flag !== "normal";
            return (
              <tr key={o.id} className={cn("border-t align-top", o.status === "cancelled" && "opacity-60")}>
                <td className="p-2"><Ltr>{fmt(o.created_at)}</Ltr></td>
                <td className="p-2"><Ltr className="font-mono font-semibold">{o.test?.code}</Ltr> <Ltr>{o.test?.name}</Ltr>
                  {o.priority === "urgent" && <span className="ms-1 text-xs font-semibold text-urgent">{t("lab.urgent")}</span>}</td>
                <td className={cn("p-2", abnormal && "font-semibold text-urgent")}>
                  {o.result && ["resulted", "verified"].includes(o.status) ? <Ltr className="whitespace-pre-wrap">{o.result}</Ltr> : <span className="text-muted-foreground">{t("lab.pending")}</span>}
                  {abnormal && <span className="ms-1 text-xs">({t(`lab.flag.${o.result_flag}`, { defaultValue: o.result_flag })})</span>}
                </td>
                <td className="p-2 text-muted-foreground"><Ltr>{o.test?.reference_range ?? "—"}</Ltr></td>
                <td className="p-2"><StatusChip status={STATUS_TONE[o.status] ?? "inactive"}>{t(`lab.status.${o.status}`)}</StatusChip></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
