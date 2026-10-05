import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Wind, Activity } from "lucide-react";
import { Ltr } from "@/components/mc/ltr";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { WARD_TYPES, byLabel, useBeds, useWards } from "@/lib/beds";
import { genderOk } from "@/lib/admissions";

/** Free beds filtered by class, only in wards whose gender matches the patient. `allowReservedId` lets an allotted bed show. */
export function BedPicker({ patientGender, value, onChange, excludeId, allowReservedId, initialClass }: {
  patientGender: string | null; value: string | null; onChange: (id: string) => void;
  excludeId?: string | null | undefined; allowReservedId?: string | null | undefined; initialClass?: string | undefined;
}) {
  const { t } = useTranslation();
  const wards = useWards();
  const beds = useBeds();
  const [cls, setCls] = useState(initialClass ?? "all");
  if (wards.isLoading || beds.isLoading) return <Skeleton className="h-40" />;
  const okWards = (wards.data ?? []).filter((w) => w.is_active && genderOk(w.gender, patientGender));
  const list = (beds.data ?? []).filter((b) => okWards.some((w) => w.id === b.ward_id) && b.id !== excludeId
    && (b.status === "free" || (b.id === allowReservedId && b.status === "reserved")) && (cls === "all" || b.bed_class === cls)).sort(byLabel);
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-2">
        <Label>{t("adm.bed")}</Label>
        <Select value={cls} onValueChange={setCls}><SelectTrigger className="w-44" aria-label={t("wd.class")}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t("adm.anyClass")}</SelectItem>{WARD_TYPES.map((v) => <SelectItem key={v} value={v}>{t(`wd.types.${v}`)}</SelectItem>)}</SelectContent></Select>
      </div>
      {list.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{t("adm.noBeds")}</p> : okWards.map((w) => {
        const wb = list.filter((b) => b.ward_id === w.id);
        if (!wb.length) return null;
        return (
          <div key={w.id} className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{w.name} · {t(`wd.genders.${w.gender}`)}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {wb.map((b) => (
                <button key={b.id} type="button" onClick={() => onChange(b.id)} aria-pressed={value === b.id}
                  className={cn("rounded-md border-2 p-2 text-start text-xs", value === b.id ? "border-primary bg-primary/10" : "border-ok bg-ok-soft text-ok-fg")}>
                  <Ltr className="block font-mono text-sm font-bold">{b.label}</Ltr>
                  <Ltr>Rs {b.daily_rate.toLocaleString("en-PK")}</Ltr>
                  <span className="mt-0.5 flex gap-1">{b.has_oxygen && <Wind className="size-3" />}{b.has_ventilator && <Activity className="size-3" />}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
