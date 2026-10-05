import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BedDouble } from "lucide-react";
import { Ltr } from "@/components/mc/ltr";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyContext } from "@/hooks/use-my-context";
import { BALANCE_ROLES } from "@/config/patient-tabs";
import { ageFrom, usePatient } from "@/lib/patients";
import { formatPkr, usePatientSummary } from "@/lib/patient-summary";
import { cn } from "@/lib/utils";

/** Sticky identity bar for every patient-related page. Sits just under the app top bar. */
export function PatientHeader({ patientId, className }: { patientId: string; className?: string }) {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const p = usePatient(patientId);
  const summary = usePatientSummary(patientId);
  const showMoney = BALANCE_ROLES.some((r) => hasRole(r));

  if (p.isLoading) return <Skeleton className="h-16 w-full" />;
  const x = p.data;
  if (!x) return null;
  const age = ageFrom(x.dob);
  const balance = summary.data?.balance_due ?? null;
  const admission = summary.data?.active_admission;

  return (
    <div className={cn("sticky top-14 z-10 -mx-3 border-b bg-background/95 px-3 py-3 backdrop-blur md:-mx-4 md:px-4", className)}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="min-w-0">
          <Link to="/patients/$patientId" params={{ patientId }} className="block truncate text-lg font-semibold hover:underline">{x.full_name}</Link>
          <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <Ltr className="font-medium text-foreground">{x.mrn}</Ltr>
            <span>·</span>
            <span>{age !== null ? t("pat.ageYears", { count: age }) : t("ph.ageUnknown")}{x.gender && ` / ${t(`doc.genders.${x.gender}`)}`}</span>
            {admission && <span className="inline-flex items-center gap-1 text-progress"><BedDouble className="size-3.5" />{t("ph.admitted")}</span>}
          </div>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-1.5" aria-label={t("pat.allergies")}>
          {x.allergies.length > 0 ? x.allergies.map((a) => (
            <span key={a} className="inline-flex items-center gap-1 rounded-full bg-urgent px-2.5 py-0.5 text-xs font-semibold text-urgent-fg">
              <AlertTriangle className="size-3" /><Ltr>{a}</Ltr>
            </span>
          )) : <span className="text-xs text-muted-foreground">{t("ph.noAllergies")}</span>}
        </div>

        <div className="flex items-center gap-5 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">{t("ph.payer")}</div>
            <div className="font-medium">{t(`ph.payers.${summary.data?.payer_type ?? "cash"}`)}</div>
          </div>
          {showMoney && (
            <div className="text-end">
              <div className="text-xs text-muted-foreground">{t("ph.balance")}</div>
              <div className={cn("tnum font-semibold", balance !== null && balance > 0 ? "text-urgent" : "")}>
                {balance === null ? "—" : <Ltr>{formatPkr(balance)}</Ltr>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
