import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { callEdgeFunction, useEdgeFunction } from "@/hooks/use-edge-function";
import { HA_FIELDS } from "@/lib/health-alerts";

type Vals = Record<string, string | number | boolean | null>;
const KEY = ["health-alert-thresholds"];

/** Company settings → Health Tracker: alert levels; saving requires the approving doctor's name. */
export function HealthTrackerTab({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: KEY, queryFn: () => callEdgeFunction<{ values: Vals; can_edit: boolean }>("save-health-alert-thresholds", { action: "get" }) });
  const save = useEdgeFunction<{ values: Vals }, { action: string; values: Vals }>("save-health-alert-thresholds", { invalidate: [KEY], successMessage: t("cs.saved") });
  const [vals, setVals] = useState<Vals>({});
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (q.data) setVals({ ...q.data.values, approved_by_doctor: "" }); }, [q.data]);

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError) return <Banner tone="danger" title={t("errors.generic")} />;
  const cur = q.data!.values;
  const doctor = String(vals["approved_by_doctor"] ?? "").trim();

  const onSave = () => {
    if (doctor.length < 3) { setErr(t("htab.doctorRequired")); return; }
    setErr(null);
    save.mutate({ action: "save", values: vals });
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("htab.intro")}</p>
      {cur["approved_by_doctor"] ? (
        <Banner tone="success" title={t("htab.approvedBy", { name: String(cur["approved_by_doctor"]), date: cur["approved_at"] ? new Date(String(cur["approved_at"])).toLocaleString() : "" })} />
      ) : <Banner tone="warning" title={t("htab.notApproved")} />}
      <div className="flex items-center justify-between gap-4 rounded-staff border p-3">
        <Label htmlFor="ht-enabled">{t("htab.enabled")}</Label>
        <Switch id="ht-enabled" checked={vals["enabled"] !== false} disabled={!canEdit} onCheckedChange={(v) => setVals((s) => ({ ...s, enabled: v }))} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {HA_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`ht-${f.key}`}>{t(`htab.f.${f.key}`)} <Ltr className="text-muted-foreground">({f.unit})</Ltr></Label>
            <Input id={`ht-${f.key}`} type="number" dir="ltr" className="tnum" min={f.min} max={f.max} disabled={!canEdit}
              value={vals[f.key] == null ? "" : String(vals[f.key])}
              onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value === "" ? null : Number(e.target.value) }))} />
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="space-y-1.5 rounded-staff border p-3">
          <Label htmlFor="ht-doctor">{t("htab.doctor")}</Label>
          <Input id="ht-doctor" value={String(vals["approved_by_doctor"] ?? "")} maxLength={120} placeholder={t("htab.doctorPh")}
            onChange={(e) => setVals((s) => ({ ...s, approved_by_doctor: e.target.value }))} />
          <p className="text-xs text-muted-foreground">{t("htab.doctorHint")}</p>
        </div>
      )}
      {err && <Banner tone="warning" title={err} />}
      {canEdit && <div className="flex justify-end"><Button onClick={onSave} disabled={save.isPending || doctor.length < 3}>{save.isPending ? t("cs.saving") : t("cs.save")}</Button></div>}
    </div>
  );
}
