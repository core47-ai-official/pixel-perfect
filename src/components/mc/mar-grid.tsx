import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Ltr } from "@/components/mc/ltr";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { cn } from "@/lib/utils";

export interface MarDose {
  id: string; medicine_name: string; dose: string; route: string; scheduled_at: string; given_at: string | null;
  status: "scheduled" | "given" | "held" | "refused" | "missed"; note: string | null; given_by: string | null;
}
const PK = 5 * 3600e3;
const pkDay = (ms: number) => new Date(ms + PK).toISOString().slice(0, 10);
const pkTime = (iso: string) => new Date(new Date(iso).getTime() + PK).toISOString().slice(11, 16);
/** A scheduled dose is overdue 30 minutes after its time. */
export const isOverdue = (d: Pick<MarDose, "status" | "scheduled_at">) => d.status === "scheduled" && new Date(d.scheduled_at).getTime() < Date.now() - 30 * 60_000;
export const DOSE_TONE: Record<string, string> = {
  given: "bg-ok-soft text-ok-fg border-ok/40",
  held: "bg-caution-soft text-caution-fg border-caution/40",
  refused: "bg-urgent-soft text-urgent-fg border-urgent/40",
  missed: "bg-inactive-soft text-inactive-fg border-inactive/40",
};

export function MarDialog({ admissionId, title, onClose }: { admissionId: string; title: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [day, setDay] = useState(() => pkDay(Date.now()));
  const [pick, setPick] = useState<MarDose | null>(null);
  const q = useQuery({
    queryKey: ["mar", admissionId, day],
    queryFn: async () => {
      const from = new Date(Date.parse(`${day}T00:00:00Z`) - PK).toISOString();
      const to = new Date(Date.parse(`${day}T00:00:00Z`) - PK + 86400e3).toISOString();
      const { data, error } = await supabase.from("med_administrations" as never)
        .select("id, medicine_name, dose, route, scheduled_at, given_at, status, note, given_by")
        .eq("admission_id", admissionId).gte("scheduled_at", from).lt("scheduled_at", to).order("scheduled_at");
      if (error) throw error;
      return (data ?? []) as unknown as MarDose[];
    },
    refetchInterval: 60_000,
  });
  const { rows, times } = useMemo(() => {
    const list = q.data ?? [];
    const times = [...new Set(list.map((d) => pkTime(d.scheduled_at)))].sort();
    const map = new Map<string, { label: string; cells: Map<string, MarDose> }>();
    for (const d of list) {
      const k = `${d.medicine_name}|${d.dose}|${d.route}`;
      if (!map.has(k)) map.set(k, { label: [d.medicine_name, d.dose, d.route].filter(Boolean).join(" · "), cells: new Map() });
      map.get(k)!.cells.set(pkTime(d.scheduled_at), d);
    }
    return { rows: [...map.values()], times };
  }, [q.data]);
  const shift = (n: number) => setDay(pkDay(Date.parse(`${day}T12:00:00Z`) - PK + n * 86400e3));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>{t("mar.title")} · {title}</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => shift(-1)} aria-label={t("mar.prev")}><ChevronLeft className="size-4 rtl:rotate-180" /></Button>
          <span className="min-w-28 text-center font-medium"><Ltr>{day}</Ltr></span>
          <Button size="icon" variant="outline" onClick={() => shift(1)} aria-label={t("mar.next")}><ChevronRight className="size-4 rtl:rotate-180" /></Button>
          <div className="ms-auto flex flex-wrap gap-1 text-xs">
            {(["given", "held", "refused", "missed"] as const).map((s) => <span key={s} className={cn("rounded border px-1.5", DOSE_TONE[s])}>{t(`mar.st.${s}`)}</span>)}
            <span className="rounded border border-warning/50 bg-warning-soft px-1.5 text-warning-fg">{t("mar.overdue")}</span>
          </div>
        </div>
        {q.isLoading ? <Skeleton className="h-40" /> : !rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">{t("mar.empty")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead><tr>
                <th className="border-b p-2 text-start font-medium">{t("mar.medicine")}</th>
                {times.map((tm) => <th key={tm} className="border-b p-2 text-center font-medium"><Ltr>{tm}</Ltr></th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td className="border-b p-2"><Ltr>{r.label}</Ltr></td>
                    {times.map((tm) => {
                      const d = r.cells.get(tm);
                      if (!d) return <td key={tm} className="border-b p-2" />;
                      const od = isOverdue(d);
                      return (
                        <td key={tm} className="border-b p-1 text-center">
                          <button type="button" onClick={() => d.status === "scheduled" && setPick(d)} title={d.note ?? undefined}
                            className={cn("w-full rounded border px-2 py-1.5 text-xs", d.status === "scheduled" ? (od ? "border-warning/60 bg-warning-soft font-semibold text-warning-fg" : "hover:bg-muted") : DOSE_TONE[d.status], d.status !== "scheduled" && "cursor-default")}>
                            {d.status === "scheduled" ? (od ? t("mar.overdue") : t("mar.due")) : t(`mar.st.${d.status}`)}
                            {d.given_at && d.status === "given" && <span className="block opacity-75"><Ltr>{pkTime(d.given_at)}</Ltr></span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pick && <RecordDose dose={pick} onDone={() => { setPick(null); void qc.invalidateQueries({ queryKey: ["mar"] }); }} onCancel={() => setPick(null)} />}
      </DialogContent>
    </Dialog>
  );
}

function RecordDose({ dose, onDone, onCancel }: { dose: MarDose; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"given" | "held" | "refused" | "missed">("given");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNote(""); }, [dose.id]);
  const needsReason = status !== "given";
  const save = async () => {
    if (needsReason && note.trim().length < 3) { toast.error(t("mar.reasonRequired")); return; }
    setBusy(true);
    try { await callEdgeFunction("record-med-administration", { id: dose.id, status, note }); toast.success(t("mar.saved")); onDone(); }
    catch (e) { toast.error((e as EdgeError).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
      <p className="text-sm font-medium"><Ltr>{dose.medicine_name} · {dose.dose} · {pkTime(dose.scheduled_at)}</Ltr></p>
      <div className="flex flex-wrap gap-2">
        {(["given", "held", "refused", "missed"] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>{t(`mar.st.${s}`)}</Button>
        ))}
      </div>
      <div className="space-y-1">
        <Label>{needsReason ? t("mar.reason") : t("mar.noteOptional")}</Label>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy || (needsReason && note.trim().length < 3)}>{t("mar.save")}</Button>
        <Button variant="ghost" onClick={onCancel}>{t("common.cancel", "Cancel")}</Button>
      </div>
    </div>
  );
}

/** Patient record: recorded doses (newest first), including held/refused reasons. */
export function PatientMarHistory({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["mar-history", patientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("med_administrations" as never)
        .select("id, medicine_name, dose, route, scheduled_at, given_at, status, note, given_by")
        .eq("patient_id", patientId).neq("status", "scheduled").order("scheduled_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as MarDose[];
    },
  });
  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold">{t("mar.history")}</h3>
      {q.isLoading ? <Skeleton className="h-20" /> : !q.data?.length ? <p className="text-sm text-muted-foreground">{t("mar.noHistory")}</p> : (
        <ul className="divide-y rounded-lg border bg-card">
          {q.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
              <span className={cn("rounded border px-1.5 text-xs", DOSE_TONE[d.status])}>{t(`mar.st.${d.status}`)}</span>
              <Ltr>{d.medicine_name} · {d.dose}</Ltr>
              <span className="text-xs text-muted-foreground"><Ltr>{new Date(d.scheduled_at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}</Ltr></span>
              {d.note && <span className="w-full text-xs">{t("mar.reason")}: {d.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
