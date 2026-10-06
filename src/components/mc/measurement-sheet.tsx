import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Activity, Droplets, HeartPulse, Scale, Thermometer, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Banner } from "@/components/mc/banner";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { checkReading, M_CONTEXTS, M_UNITS, QUICK_TYPES, type Measurement, type MType } from "@/lib/measurements";
import { cn } from "@/lib/utils";

export const M_ICONS: Record<MType, typeof Activity> = { bp: HeartPulse, glucose: Droplets, weight: Scale, temp: Thermometer, pulse: Activity, spo2: Wind };

const localNow = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Six big quick-add buttons; each opens the bottom sheet. */
export function QuickAddMeasurements({ onEdit }: { onEdit?: Measurement | null }) {
  const { t } = useTranslation();
  const [type, setType] = useState<MType | null>(null);
  const [editing, setEditing] = useState<Measurement | null>(null);
  useEffect(() => { if (onEdit) { setEditing(onEdit); setType(onEdit.type as MType); } }, [onEdit]);
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {QUICK_TYPES.map((k) => {
          const Icon = M_ICONS[k];
          return (
            <button key={k} type="button" onClick={() => { setEditing(null); setType(k); }}
              className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-patient border bg-card text-sm font-medium shadow-sm hover:bg-accent">
              <Icon className="size-6 text-primary" aria-hidden />{t(`meas.q.${k}`)}
            </button>
          );
        })}
      </div>
      {type && <MeasurementSheet key={(editing?.id ?? "") + type} type={type} editing={editing} onClose={() => { setType(null); setEditing(null); }} />}
    </>
  );
}

function MeasurementSheet({ type, editing, onClose }: { type: MType; editing: Measurement | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const units = M_UNITS[type];
  const ctxs = M_CONTEXTS[type];
  const [v1, setV1] = useState(editing ? String(editing.original_value ?? editing.value_1) : "");
  const [v2, setV2] = useState(editing?.value_2 != null ? String(editing.value_2) : "");
  const [unit, setUnit] = useState(editing?.original_unit ?? units[0]);
  const [ctx, setCtx] = useState<string | null>(editing?.context ?? ctxs?.[0] ?? null);
  const [at, setAt] = useState(editing ? localNow(new Date(editing.measured_at)) : localNow());
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const n1 = Number(v1), n2 = type === "bp" ? Number(v2) : null;
    if (!v1 || (type === "bp" && !v2)) { setErr(t(type === "bp" ? "meas.err.bothBp" : "meas.err.number")); return; }
    const e = checkReading(type, n1, n2, unit);
    if (e) { setErr(t(e.key, { ...e.params, label: e.params?.label ? t(String(e.params.label)) : "" })); return; }
    setErr(null); setBusy(true);
    try {
      const body = { type, value_1: n1, value_2: n2, unit, context: ctx, measured_at: new Date(at).toISOString(), notes };
      await callEdgeFunction(editing ? "update-measurement" : "log-measurement", editing ? { ...body, id: editing.id } : body);
      await qc.invalidateQueries({ queryKey: ["measurements"] });
      toast.success(t("meas.saved"));
      onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };

  const big = "h-16 text-center text-3xl font-semibold";
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-patient">
        <SheetHeader><SheetTitle>{t(editing ? "meas.editTitle" : "meas.addTitle", { type: t(`meas.t.${type}`) })}</SheetTitle></SheetHeader>
        <form className="mx-auto mt-3 max-w-md space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {type === "bp" ? (
            <div className="flex items-end gap-2" dir="ltr">
              <div className="flex-1 space-y-1"><Label htmlFor="m-sys">{t("meas.sys")}</Label><Input id="m-sys" autoFocus inputMode="numeric" className={big} value={v1} onChange={(e) => setV1(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} /></div>
              <span className="pb-4 text-3xl text-muted-foreground">/</span>
              <div className="flex-1 space-y-1"><Label htmlFor="m-dia">{t("meas.dia")}</Label><Input id="m-dia" inputMode="numeric" className={big} value={v2} onChange={(e) => setV2(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} /></div>
            </div>
          ) : (
            <div className="space-y-1" dir="ltr">
              <Label htmlFor="m-v1">{t(`meas.t.${type}`)}</Label>
              <Input id="m-v1" autoFocus inputMode="decimal" className={big} value={v1} onChange={(e) => setV1(e.target.value.replace(/[^0-9.]/g, "").slice(0, 6))} />
            </div>
          )}
          {units.length > 1 ? (
            <div className="flex gap-2" dir="ltr">{units.map((u) => <Chip key={u} on={unit === u} onClick={() => setUnit(u)}>{u}</Chip>)}</div>
          ) : <p className="text-center text-sm text-muted-foreground" dir="ltr">{units[0]}</p>}
          {ctxs && <div className="flex flex-wrap gap-2">{ctxs.map((c) => <Chip key={c} on={ctx === c} onClick={() => setCtx(c)}>{t(`meas.ctx.${c}`)}</Chip>)}</div>}
          {err && <Banner tone="warning" title={err} />}
          <Button type="submit" className="h-12 w-full text-base" disabled={busy}>{t("meas.save")}</Button>
          <div className="space-y-1"><Label htmlFor="m-at">{t("meas.time")}</Label><Input id="m-at" type="datetime-local" dir="ltr" value={at} max={localNow()} onChange={(e) => setAt(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="m-notes">{t("meas.notes")}</Label><Textarea id="m-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn("min-h-10 rounded-full border px-4 text-sm", on ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-card")}>{children}</button>
  );
}
