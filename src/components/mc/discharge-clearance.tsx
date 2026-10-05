import type { UseQueryResult } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Ltr } from "@/components/mc/ltr";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPkr } from "@/lib/patient-summary";
import { useClearance, type Clearance } from "@/lib/installments";
import { cn } from "@/lib/utils";

export const useDischargeClearance = (admissionId: string) => useClearance(admissionId);

/** Billing clearance shown before discharge: green when cleared, red with what's owed otherwise. */
export function ClearanceBox({ q }: { q: UseQueryResult<Clearance> }) {
  const { t } = useTranslation();
  if (q.isLoading) return <Skeleton className="h-16 w-full" />;
  if (q.isError || !q.data) return <p className="rounded-staff bg-urgent-soft p-3 text-sm text-urgent-fg">{t("clr.error")}</p>;
  const c = q.data;
  return (
    <div className={cn("space-y-2 rounded-staff p-3 text-sm", c.cleared ? "bg-ok-soft text-ok-fg" : "bg-urgent-soft text-urgent-fg")}>
      <p className="flex items-center gap-2 font-semibold">
        {c.cleared ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
        {c.cleared ? t("clr.cleared") : t("clr.blocked", { amount: formatPkr(c.balance_due) })}
      </p>
      {c.bills.length > 0 && (
        <ul className="space-y-0.5">
          {c.bills.map((b) => (
            <li key={b.invoice_id} className="flex justify-between gap-2">
              <Ltr>{b.invoice_no}</Ltr>
              <span>{b.covered_by ? t(`clr.by.${b.covered_by}`) : <Ltr>{formatPkr(b.balance)}</Ltr>}</span>
            </li>
          ))}
        </ul>
      )}
      {!c.cleared && <p>{t("clr.howTo")}</p>}
    </div>
  );
}
