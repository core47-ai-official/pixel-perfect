import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { severityFace, SymptomSheet } from "@/components/mc/symptom-sheet";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { COMMON_SYMPTOMS, openAttachment, useRecentSymptoms, type SymptomLog } from "@/lib/symptoms";
import { pkDay, pkTime } from "@/lib/portal";

/** Health tab section: add button + recent symptom entries with edit, delete and private attachment viewing. */
export function SymptomSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useRecentSymptoms();
  const [sheet, setSheet] = useState<{ editing: SymptomLog | null } | null>(null);
  const [del, setDel] = useState<SymptomLog | null>(null);
  const name = (s: string) => { const hit = COMMON_SYMPTOMS.find(([, en]) => en === s); return hit ? t(`sym.s.${hit[0]}`) : s; };
  const remove = async () => {
    if (!del) return;
    try { await callEdgeFunction("delete-symptom", { id: del.id }); toast.success(t("sym.deleted")); await qc.invalidateQueries({ queryKey: ["symptoms"] }); }
    catch (e) { toast.error((e as Error).message); } finally { setDel(null); }
  };
  const view = async (p: string) => { try { await openAttachment(p); } catch { toast.error(t("sym.err.open")); } };
  return (
    <PCard>
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">{t("sym.title")}</p>
        <Button size="sm" onClick={() => setSheet({ editing: null })}><Plus className="size-4" />{t("sym.add")}</Button>
      </div>
      {!q.data?.length ? <p className="text-sm text-muted-foreground">{t("sym.none")}</p> : (
        <ul className="divide-y">
          {q.data.map((s) => {
            const Face = severityFace(s.severity);
            return (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <Face className="size-6 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{name(s.symptom)} <span className="text-sm font-normal text-muted-foreground">· <Ltr>{s.severity}/10</Ltr></span></p>
                  <span className="text-xs text-muted-foreground"><Ltr>{pkDay(s.started_at)} {pkTime(s.started_at)}</Ltr>{s.triggers.length ? ` · ${s.triggers.map((g) => t(`sym.tr.${g}`)).join(", ")}` : ""}</span>
                </div>
                {s.attachment_url && <Button variant="ghost" size="icon" aria-label={t("sym.viewPhoto")} onClick={() => view(s.attachment_url!)}><Paperclip className="size-4" /></Button>}
                <Button variant="ghost" size="icon" aria-label={t("meas.edit")} onClick={() => setSheet({ editing: s })}><Pencil className="size-4" /></Button>
                <Button variant="ghost" size="icon" aria-label={t("meas.delete")} onClick={() => setDel(s)}><Trash2 className="size-4" /></Button>
              </li>
            );
          })}
        </ul>
      )}
      {sheet && <SymptomSheet key={sheet.editing?.id ?? "new"} editing={sheet.editing} onClose={() => setSheet(null)} />}
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("sym.deleteConfirm")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("trk.back")}</AlertDialogCancel><AlertDialogAction onClick={remove}>{t("meas.delete")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PCard>
  );
}
