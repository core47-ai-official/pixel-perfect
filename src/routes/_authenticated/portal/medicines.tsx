import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlarmClock, ArrowLeft, Check, Hospital, Pill, Plus, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { pkDay, pkTime } from "@/lib/portal";
import { adherence, isToday, useMedicines, type DoseEvent, type MedSchedule } from "@/lib/medicines";

export const Route = createFileRoute("/_authenticated/portal/medicines")({
  head: () => ({ meta: [
    { title: "My medicines — Patient portal" },
    { name: "description", content: "Today's doses, reminders and how well you are keeping up with each medicine." },
    { property: "og:title", content: "My medicines — Patient portal" },
    { property: "og:description", content: "Today's doses and dose reminders." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: MedicinesPage,
});

function MedicinesPage() {
  const { t } = useTranslation();
  const q = useMedicines();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ editing: MedSchedule | null } | null>(null);

  const act = async (e: DoseEvent, action: "taken" | "skipped" | "snooze") => {
    setBusy(e.id);
    try {
      await callEdgeFunction("log-dose", { dose_event_id: e.id, action });
      toast.success(t(`meds.done_${action}`));
      await qc.invalidateQueries({ queryKey: ["tracker-medicines"] });
    } catch (err) { toast.error((err as Error).message || t("meds.saveFailed")); }
    finally { setBusy(null); }
  };

  if (q.isLoading) return <Skeleton className="h-72 rounded-patient" />;
  if (q.isError || !q.data) return <Banner tone="danger" title={t("meds.loadFailed")} />;
  const { schedules, events } = q.data;
  const byId = new Map(schedules.map((s) => [s.id, s]));
  const today = events.filter((e) => isToday(e.due_at) && byId.get(e.schedule_id)?.active);
  const history = events.filter((e) => e.status && !isToday(e.due_at)).reverse().slice(0, 40);

  return (
    <div className="space-y-4">
      <Link to="/portal/health" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="size-4 rtl:rotate-180" />{t("portal.health")}</Link>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("meds.title")}</h1>
        <Button size="sm" onClick={() => setSheet({ editing: null })}><Plus className="size-4" />{t("meds.add")}</Button>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">{t("meds.today")}</h2>
        {!today.length && <PCard><p className="text-sm text-muted-foreground">{t("meds.noneToday")}</p></PCard>}
        {today.map((e) => {
          const s = byId.get(e.schedule_id)!;
          const late = !e.status && Date.parse(e.due_at) < Date.now();
          return (
            <PCard key={e.id} className="space-y-3" data-testid="dose-card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Ltr className="block font-medium">{s.name}</Ltr>
                  <p className="text-sm text-muted-foreground"><Ltr>{pkTime(e.due_at)}</Ltr>{s.dose ? <> · <Ltr>{s.dose}</Ltr></> : null}</p>
                  {e.snoozed_until && !e.status && <p className="text-xs text-muted-foreground">{t("meds.snoozedTill")} <Ltr>{pkTime(e.snoozed_until)}</Ltr></p>}
                </div>
                <StatusChip status={e.status} late={late} />
              </div>
              {(!e.status || e.status === "missed") && Date.parse(e.due_at) <= Date.now() + 2 * 3600e3 && (
                <div className="grid grid-cols-3 gap-2">
                  <Button disabled={busy === e.id} onClick={() => act(e, "taken")}><Check className="size-4" />{t("meds.take")}</Button>
                  <Button variant="outline" disabled={busy === e.id} onClick={() => act(e, "skipped")}><SkipForward className="size-4" />{t("meds.skip")}</Button>
                  {!e.status && <Button variant="ghost" disabled={busy === e.id} onClick={() => act(e, "snooze")}><AlarmClock className="size-4" />{t("meds.snooze")}</Button>}
                </div>
              )}
            </PCard>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">{t("meds.list")}</h2>
        {!schedules.length && <PCard><p className="text-sm text-muted-foreground">{t("trk.noMedicines")}</p></PCard>}
        {schedules.map((s) => {
          const pct = adherence(events.filter((e) => e.schedule_id === s.id));
          return (
            <PCard key={s.id} className="flex items-center justify-between gap-3">
              <button type="button" className="min-w-0 text-start" onClick={() => setSheet({ editing: s })}>
                <p className="flex items-center gap-1.5 font-medium">{s.source === "hospital" ? <Hospital className="size-4 shrink-0" aria-label={t("meds.fromHospital")} /> : <Pill className="size-4 shrink-0" aria-hidden />}<Ltr className="truncate">{s.name}</Ltr></p>
                <p className="text-xs text-muted-foreground">
                  {s.dose && <Ltr>{s.dose} · </Ltr>}<Ltr>{s.times.join(", ") || t("meds.asNeeded")}</Ltr>
                  {s.end_date && <> · {t("meds.until")} <Ltr>{s.end_date}</Ltr></>}
                  {!s.active && <> · {t("meds.paused")}</>}
                </p>
              </button>
              <div className="shrink-0 text-end">
                <Ltr className="text-lg font-semibold">{pct === null ? "—" : `${pct}%`}</Ltr>
                <p className="text-xs text-muted-foreground">{t("meds.adherence")}</p>
              </div>
            </PCard>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">{t("meds.history")}</h2>
        <PCard>
          {history.length ? (
            <ul className="divide-y">{history.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span><Ltr className="font-medium">{byId.get(e.schedule_id)?.name ?? ""}</Ltr> <span className="text-muted-foreground"><Ltr>{pkDay(e.due_at)} {pkTime(e.due_at)}</Ltr></span></span>
                <StatusChip status={e.status} late={false} />
              </li>
            ))}</ul>
          ) : <p className="text-sm text-muted-foreground">{t("meds.noHistory")}</p>}
        </PCard>
      </section>
      <p className="text-xs text-muted-foreground">{t("meds.gentleNote")}</p>
      {sheet && <ScheduleSheet editing={sheet.editing} onClose={() => setSheet(null)} />}
    </div>
  );
}

function StatusChip({ status, late }: { status: string | null; late: boolean }) {
  const { t } = useTranslation();
  const key = status ?? (late ? "due" : "upcoming");
  const tone = status === "taken" ? "bg-primary/15 text-primary" : status === "missed" ? "bg-warning/15 text-foreground" : "bg-muted text-muted-foreground";
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${tone}`}>{t(`meds.st_${key}`)}</span>;
}

function ScheduleSheet({ editing, onClose }: { editing: MedSchedule | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const hospital = editing?.source === "hospital";
  const [name, setName] = useState(editing?.name ?? "");
  const [dose, setDose] = useState(editing?.dose ?? "");
  const [times, setTimes] = useState<string[]>(editing?.times?.length ? editing.times : ["08:00"]);
  const [endDate, setEndDate] = useState(editing?.end_date ?? "");
  const [active, setActive] = useState(editing?.active ?? true);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await callEdgeFunction("save-medication-schedule", hospital ? { id: editing!.id, active }
        : { id: editing?.id, name, dose, times: times.filter(Boolean), end_date: endDate || null, active, start_date: editing?.start_date });
      toast.success(t("meds.saved"));
      await qc.invalidateQueries({ queryKey: ["tracker-medicines"] });
      onClose();
    } catch (err) { toast.error((err as Error).message || t("meds.saveFailed")); }
    finally { setSaving(false); }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-patient">
        <SheetHeader><SheetTitle>{editing ? t("meds.edit") : t("meds.add")}</SheetTitle></SheetHeader>
        <div className="space-y-4 p-4">
          {hospital && <Banner tone="info" title={t("meds.hospitalNote")} />}
          <div className="space-y-1.5"><Label htmlFor="mn">{t("meds.name")}</Label><Input id="mn" value={name} disabled={hospital} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="md">{t("meds.dose")}</Label><Input id="md" value={dose} disabled={hospital} onChange={(e) => setDose(e.target.value)} /></div>
          {!hospital && (
            <div className="space-y-1.5">
              <Label>{t("meds.times")}</Label>
              {times.map((tm, i) => (
                <div key={i} className="flex gap-2">
                  <Input type="time" value={tm} onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))} />
                  {times.length > 1 && <Button variant="ghost" onClick={() => setTimes(times.filter((_, j) => j !== i))}>{t("common.remove")}</Button>}
                </div>
              ))}
              {times.length < 6 && <Button variant="outline" size="sm" onClick={() => setTimes([...times, "20:00"])}><Plus className="size-4" />{t("meds.addTime")}</Button>}
            </div>
          )}
          {!hospital && <div className="space-y-1.5"><Label htmlFor="me">{t("meds.endDate")}</Label><Input id="me" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>}
          <div className="flex items-center justify-between"><Label htmlFor="ma">{t("meds.active")}</Label><Switch id="ma" checked={active} onCheckedChange={setActive} /></div>
          <Button className="w-full" size="lg" disabled={saving || (!hospital && !name.trim())} onClick={save}>{t("meds.save")}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
