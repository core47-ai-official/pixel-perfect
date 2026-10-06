import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { M_ICONS, MeasurementSheet } from "@/components/mc/measurement-sheet";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { formatReading, useRecentMeasurements, type Measurement, type MType } from "@/lib/measurements";
import { pkDay, pkTime } from "@/lib/portal";

export function RecentMeasurements() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useRecentMeasurements();
  const [edit, setEdit] = useState<Measurement | null>(null);
  const [del, setDel] = useState<Measurement | null>(null);
  const remove = async () => {
    if (!del) return;
    try { await callEdgeFunction("delete-measurement", { id: del.id }); toast.success(t("meas.deleted")); await qc.invalidateQueries({ queryKey: ["measurements"] }); }
    catch (e) { toast.error((e as Error).message); } finally { setDel(null); }
  };
  return (
    <PCard>
      <p className="mb-2 font-medium">{t("meas.recent")}</p>
      {!q.data?.length ? <p className="text-sm text-muted-foreground">{t("meas.none")}</p> : (
        <ul className="divide-y">
          {q.data.map((m) => {
            const Icon = M_ICONS[m.type as MType] ?? M_ICONS.pulse;
            return (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <Icon className="size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Ltr className="block font-semibold">{formatReading(m)}</Ltr>
                  <span className="text-xs text-muted-foreground"><Ltr>{pkDay(m.measured_at)} {pkTime(m.measured_at)}</Ltr>{m.context ? ` · ${t(`meas.ctx.${m.context}`)}` : ""}</span>
                </div>
                {m.type !== "custom" && <Button variant="ghost" size="icon" aria-label={t("meas.edit")} onClick={() => setEdit(m)}><Pencil className="size-4" /></Button>}
                <Button variant="ghost" size="icon" aria-label={t("meas.delete")} onClick={() => setDel(m)}><Trash2 className="size-4" /></Button>
              </li>
            );
          })}
        </ul>
      )}
      {edit && <MeasurementSheet key={edit.id} type={edit.type as MType} editing={edit} onClose={() => setEdit(null)} />}
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("meas.deleteConfirm")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("trk.back")}</AlertDialogCancel><AlertDialogAction onClick={remove}>{t("meas.delete")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PCard>
  );
}
