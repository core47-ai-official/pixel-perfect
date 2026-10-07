import { useTranslation } from "react-i18next";
import { Info, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/mc/ltr";
import { HA_FIELDS, type HealthAlertResult } from "@/lib/health-alerts";

/** Informational banner after a reading crosses a hospital alert level. Never uses diagnostic wording. */
export function HealthAlertBanner({ result, onDone }: { result: HealthAlertResult; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="space-y-3 rounded-patient border border-warning/30 bg-warning-soft p-4 text-warning-fg">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p className="font-semibold">{t("halert.title")}</p>
          <p className="text-xs font-medium uppercase tracking-wide">{t("halert.notDiagnosis")}</p>
        </div>
      </div>
      <ul className="space-y-1 text-sm">
        {result.alerts.map((a) => {
          const f = HA_FIELDS.find((x) => x.key === a.key);
          return (
            <li key={a.key}>
              {t(`halert.${a.side}`, { measure: t(`halert.m.${a.key}`) })}{" "}
              <Ltr className="font-semibold">{a.value} {f?.unit}</Ltr> ({t("halert.level")} <Ltr>{a.threshold} {f?.unit}</Ltr>)
            </li>
          );
        })}
      </ul>
      <p className="text-sm">{t("halert.advice")}</p>
      <div className="grid gap-2">
        {result.hospital_phone ? (
          <Button asChild variant="secondary" className="h-11"><a href={`tel:${result.hospital_phone.replace(/[^0-9+]/g, "")}`}><Phone /> {t("halert.contact")} <Ltr>{result.hospital_phone}</Ltr></a></Button>
        ) : <p className="text-sm font-medium">{t("halert.contactNoPhone")}</p>}
        <p className="text-sm">{t("halert.emergency")}</p>
        <div className="grid grid-cols-2 gap-2">
          <a href="tel:1122" className="rounded-patient bg-urgent-soft p-3 text-center"><span className="block text-xs text-urgent-fg">{t("trk.rescue")}</span><Ltr className="text-2xl font-bold text-urgent-fg">1122</Ltr></a>
          <a href="tel:115" className="rounded-patient bg-urgent-soft p-3 text-center"><span className="block text-xs text-urgent-fg">{t("trk.edhi")}</span><Ltr className="text-2xl font-bold text-urgent-fg">115</Ltr></a>
        </div>
      </div>
      <Button className="h-11 w-full" onClick={onDone}>{t("halert.ok")}</Button>
    </div>
  );
}
