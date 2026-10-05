import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { useWardBoard, useHandoverNotes, currentShift, SHIFTS, type Shift } from "@/lib/ward-board";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/handover")({
  head: () => ({ meta: [{ title: "Shift handover — MediCore HMS" }, { name: "description", content: "Ward handover notes grouped by shift." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("handover")}>
      <HandoverPage />
    </RequireRole>
  ),
});

function HandoverPage() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const canWrite = ["super_admin", "admin", "dept_head", "doctor", "nurse"].some((r) => hasRole(r as never));
  const board = useWardBoard();
  const now = currentShift();
  const [wardId, setWardId] = useState<string | null>(null);
  const [date, setDate] = useState(now.date);
  const [shift, setShift] = useState<Shift>(now.shift);
  const [note, setNote] = useState("");
  const wards = board.data?.wards ?? [];
  const ward = wardId ?? wards[0]?.id ?? null;
  const notes = useHandoverNotes(ward, date);
  const save = useEdgeFunction("save-handover-note", { invalidate: [["handover"]], successMessage: t("nb.ho.saved") });
  const submit = async () => {
    if (note.trim().length < 3) { toast.error(t("wd.required")); return; }
    try { await save.mutateAsync({ ward_id: ward, shift_date: date, shift, note }); setNote(""); } catch { /* shown */ }
  };

  if (board.isLoading) return <Skeleton className="h-64" />;
  if (board.data && !board.data.assigned) return <p className="text-muted-foreground">{t("nb.noAssign")}</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label>{t("nb.ho.ward")}</Label>
          <Select value={ward ?? ""} onValueChange={setWardId}><SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>{wards.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label htmlFor="ho-date">{t("nb.ho.date")}</Label>
          <Input id="ho-date" type="date" dir="ltr" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {SHIFTS.map((s) => {
          const list = (notes.data ?? []).filter((n) => n.shift === s);
          return (
            <section key={s} className={cn("space-y-2 rounded-lg border bg-card p-3", s === now.shift && date === now.date && "border-primary")}>
              <h2 className="font-semibold">{t(`nb.ho.shifts.${s}`)}</h2>
              {notes.isLoading ? <Skeleton className="h-20" /> : list.length === 0 ? <p className="text-sm text-muted-foreground">{t("nb.ho.none")}</p> :
                list.map((n) => (
                  <article key={n.id} className="rounded-md bg-muted p-3 text-sm">
                    <p className="whitespace-pre-wrap">{n.note}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{t("nb.ho.by", { name: n.written_by_name })} · <Ltr>{new Date(n.created_at).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" })}</Ltr></p>
                  </article>
                ))}
            </section>
          );
        })}
      </div>
      {canWrite && ward && (
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">{t("nb.ho.write")}</h2>
          <div className="flex flex-wrap gap-2">
            {SHIFTS.map((s) => <Button key={s} size="sm" variant={shift === s ? "default" : "outline"} onClick={() => setShift(s)}>{t(`nb.ho.shifts.${s}`)}</Button>)}
          </div>
          <Textarea rows={5} value={note} maxLength={4000} placeholder={t("nb.ho.placeholder")} onChange={(e) => setNote(e.target.value)} aria-label={t("nb.ho.note")} />
          <div className="flex justify-end"><Button onClick={submit} disabled={save.isPending}>{t("wd.save")}</Button></div>
        </section>
      )}
    </div>
  );
}
