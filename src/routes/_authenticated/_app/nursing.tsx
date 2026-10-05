import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, AlertTriangle, Clock, Wind } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Ltr } from "@/components/mc/ltr";
import { Banner } from "@/components/mc/banner";
import { VitalsPanel } from "@/components/mc/vitals-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { BED_TILE, type BedStatus } from "@/lib/beds";
import { useWardBoard, type BoardBed } from "@/lib/ward-board";

export const Route = createFileRoute("/_authenticated/_app/nursing")({
  head: () => ({ meta: [{ title: "Ward board — MediCore HMS" }, { name: "description", content: "Nurse ward board with patients, days admitted, latest vitals and vitals due." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("nursing")}>
      <WardBoardPage />
    </RequireRole>
  ),
});

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" });

function WardBoardPage() {
  const { t } = useTranslation();
  const q = useWardBoard();
  const [vitalsFor, setVitalsFor] = useState<BoardBed | null>(null);
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError || !q.data) return <Banner tone="warning" title={t("dash.widgetFailed")} />;
  const { wards, beds, due_hours, assigned } = q.data;
  if (!assigned) return <Banner tone="info" title={t("nb.noAssign")} />;
  if (!wards.length) return <p className="text-muted-foreground">{t("nb.noWards")}</p>;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("nb.every", { n: due_hours })}</p>
      {wards.map((w) => {
        const list = beds.filter((b) => b.ward_id === w.id).sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
        return (
          <section key={w.id} className="space-y-2">
            <h2 className="text-base font-semibold">{w.name} <span className="text-xs font-normal text-muted-foreground">· {t(`wd.types.${w.type}`)}</span></h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((b) => <BedCard key={b.id} bed={b} onVitals={() => setVitalsFor(b)} />)}
            </div>
          </section>
        );
      })}
      {vitalsFor?.patient && <VitalsPanel patientId={vitalsFor.patient.id} title={`${t("nb.vitals.title")} · ${vitalsFor.label} · ${vitalsFor.patient.full_name}`} onClose={() => setVitalsFor(null)} />}
    </div>
  );
}

function BedCard({ bed, onVitals }: { bed: BoardBed; onVitals: () => void }) {
  const { t } = useTranslation();
  const p = bed.patient;
  const v = bed.latest_vitals;
  const overdue = bed.vitals_due_at ? new Date(bed.vitals_due_at).getTime() < Date.now() : false;
  return (
    <div className={cn("rounded-lg border bg-card p-3", overdue && "border-urgent ring-1 ring-urgent")}>
      <div className="flex items-center gap-2">
        <span className={cn("rounded-md border-2 px-2 py-0.5 font-mono text-sm font-bold", BED_TILE[bed.status as BedStatus])}><Ltr>{bed.label}</Ltr></span>
        {p ? <span className="truncate font-medium">{p.full_name}</span> : <span className="text-sm text-muted-foreground">{t(`wd.statuses.${bed.status}`)}</span>}
        <span className="ms-auto flex gap-1 text-muted-foreground">{bed.has_oxygen && <Wind className="size-3.5" />}{bed.has_ventilator && <Activity className="size-3.5" />}</span>
      </div>
      {bed.status === "occupied" && !p && <p className="mt-2 text-xs text-muted-foreground">{t("nb.patientSoon")}</p>}
      {p && (
        <div className="mt-2 space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <Ltr>{p.mrn}</Ltr>
            {bed.days_admitted && <span>{t("nb.days", { n: bed.days_admitted })}</span>}
            {p.allergies?.length > 0 && <span className="text-urgent">{t("nb.allergies")}: <Ltr>{p.allergies.join(", ")}</Ltr></span>}
          </div>
          {v ? (
            <div className="grid grid-cols-4 gap-1 text-xs">
              <Vital label="BP" value={v.bp_sys && v.bp_dia ? `${v.bp_sys}/${v.bp_dia}` : "—"} />
              <Vital label="HR" value={v.pulse ?? "—"} />
              <Vital label="T" value={v.temp_c ?? "—"} />
              <Vital label="SpO₂" value={v.spo2 ?? "—"} />
            </div>
          ) : <p className="text-xs text-muted-foreground">{t("nb.noVitals")}</p>}
          <div className="flex items-center justify-between gap-2">
            {bed.vitals_due_at && (
              <span className={cn("inline-flex items-center gap-1 text-xs", overdue ? "font-semibold text-urgent" : "text-muted-foreground")}>
                {overdue ? <AlertTriangle className="size-3.5" /> : <Clock className="size-3.5" />}
                {overdue ? t("nb.overdue") : t("nb.dueIn", { time: fmtTime(bed.vitals_due_at) })}
              </span>
            )}
            <Button size="sm" variant={overdue ? "default" : "outline"} onClick={onVitals}>{t("nb.record")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Vital({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded bg-muted px-1.5 py-1"><div className="text-[10px] text-muted-foreground">{label}</div><Ltr className="font-semibold">{value}</Ltr></div>;
}
