import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Angry, Annoyed, Frown, Laugh, Meh, Paperclip, Search, Smile, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Banner } from "@/components/mc/banner";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { ATTACH_MAX, ATTACH_TYPES, COMMON_SYMPTOMS, fileToBase64, SYMPTOM_TRIGGERS, type SymptomLog } from "@/lib/symptoms";
import { cn } from "@/lib/utils";

const localDT = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export const severityFace = (n: number) => (n <= 2 ? Laugh : n <= 4 ? Smile : n <= 6 ? Meh : n <= 8 ? Frown : n === 9 ? Annoyed : Angry);
const severityTone = (n: number) => (n <= 3 ? "text-ok-fg" : n <= 6 ? "text-warning-fg" : "text-urgent-fg");

export function SymptomSheet({ editing, onClose }: { editing: SymptomLog | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [symptom, setSymptom] = useState(editing?.symptom ?? "");
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState(editing?.severity ?? 5);
  const [start, setStart] = useState(editing ? localDT(new Date(editing.started_at)) : localDT());
  const [end, setEnd] = useState(editing?.ended_at ? localDT(new Date(editing.ended_at)) : "");
  const [triggers, setTriggers] = useState<string[]>(editing?.triggers ?? []);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [keepAttachment, setKeepAttachment] = useState(!!editing?.attachment_url);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return COMMON_SYMPTOMS.filter(([id, en]) => !s || en.toLowerCase().includes(s) || t(`sym.s.${id}`).toLowerCase().includes(s));
  }, [q, t]);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (!ATTACH_TYPES.includes(f.type)) { setErr(t("sym.err.type")); return; }
    if (f.size > ATTACH_MAX) { setErr(t("sym.err.size")); return; }
    setErr(null); setFile(f);
  };

  const save = async () => {
    if (symptom.trim().length < 2) { setErr(t("sym.err.pick")); return; }
    if (end && end < start) { setErr(t("sym.err.end")); return; }
    setBusy(true); setErr(null);
    try {
      let attachment_url: string | null = keepAttachment ? editing?.attachment_url ?? null : null;
      if (file) {
        const up = await callEdgeFunction<{ path: string }>("upload-symptom-attachment", { content_base64: await fileToBase64(file), content_type: file.type });
        attachment_url = up.path;
      }
      const body = { symptom: symptom.trim(), severity, started_at: new Date(start).toISOString(), ended_at: end ? new Date(end).toISOString() : null, triggers, notes, attachment_url };
      await callEdgeFunction(editing ? "update-symptom" : "log-symptom", editing ? { ...body, id: editing.id } : body);
      await qc.invalidateQueries({ queryKey: ["symptoms"] });
      toast.success(t("sym.saved"));
      onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };

  const Face = severityFace(severity);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-patient">
        <SheetHeader><SheetTitle>{t(editing ? "sym.editTitle" : "sym.addTitle")}</SheetTitle></SheetHeader>
        <form className="mx-auto mt-3 max-w-md space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="space-y-2">
            <Label>{t("sym.what")}</Label>
            <div className="relative"><Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input className="ps-9" placeholder={t("sym.search")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
              {list.map(([id, en]) => <Chip key={id} on={symptom === en} onClick={() => setSymptom(en)}>{t(`sym.s.${id}`)}</Chip>)}
              {q.trim().length > 1 && !list.length && <Chip on={symptom === q.trim()} onClick={() => setSymptom(q.trim())}>{t("sym.useTyped", { name: q.trim() })}</Chip>}
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("sym.severity")}</Label>
            <div className="flex items-center gap-3">
              <Face className={cn("size-10 shrink-0", severityTone(severity))} aria-hidden />
              <Slider min={1} max={10} step={1} value={[severity]} onValueChange={(v) => setSeverity(v[0] ?? 5)} aria-label={t("sym.severity")} className="flex-1" />
              <span className={cn("w-8 text-center text-2xl font-semibold", severityTone(severity))} dir="ltr">{severity}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t(`sym.sev.${severity <= 3 ? "mild" : severity <= 6 ? "moderate" : "severe"}`)}</p>
          </div>
          {err && <Banner tone="warning" title={err} />}
          <Button type="submit" className="h-12 w-full text-base" disabled={busy}>{busy ? t("sym.saving") : t("meas.save")}</Button>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label htmlFor="s-start">{t("sym.start")}</Label><Input id="s-start" type="datetime-local" dir="ltr" value={start} max={localDT()} onChange={(e) => setStart(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="s-end">{t("sym.end")}</Label><Input id="s-end" type="datetime-local" dir="ltr" value={end} max={localDT()} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <div className="space-y-1">
            <Label>{t("sym.triggers")}</Label>
            <div className="flex flex-wrap gap-2">{SYMPTOM_TRIGGERS.map((g) => (
              <Chip key={g} on={triggers.includes(g)} onClick={() => setTriggers((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))}>{t(`sym.tr.${g}`)}</Chip>
            ))}</div>
          </div>
          <div className="space-y-1"><Label htmlFor="s-notes">{t("meas.notes")}</Label><Textarea id="s-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="space-y-1">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
            {file || keepAttachment ? (
              <div className="flex items-center justify-between rounded-lg border p-2 text-sm">
                <span className="flex min-w-0 items-center gap-2"><Paperclip className="size-4 shrink-0" aria-hidden /><span className="truncate">{file?.name ?? t("sym.attached")}</span></span>
                <Button type="button" variant="ghost" size="icon" aria-label={t("trk.remove")} onClick={() => { setFile(null); setKeepAttachment(false); }}><X className="size-4" /></Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}><Paperclip className="size-4" />{t("sym.addPhoto")}</Button>
            )}
            <p className="text-xs text-muted-foreground">{t("sym.photoHint")}</p>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={cn("min-h-10 rounded-full border px-3 text-sm", on ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-card")}>{children}</button>;
}
