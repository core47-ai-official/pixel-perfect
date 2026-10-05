import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Save } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { StatusChip } from "@/components/mc/status-chip";
import { Calendar, CALENDAR_PALETTES, TONE_CLASS, type CalColumn, type CalEvent, type CalendarView } from "@/components/mc/calendar";
import { cn } from "@/lib/utils";
import {
  SHIFT_TYPES, addDaysYmd, mondayOf, shiftSpan, ymdLocal,
  type RosterShift, type RosterWarning, type RosterWeek, type SaveResult, type ShiftType,
} from "@/lib/roster";

export const Route = createFileRoute("/_authenticated/_app/roster")({
  head: () => ({ meta: [
    { title: "Duty roster — MediCore HMS" },
    { name: "description", content: "Plan weekly shifts per staff member, copy last week, and review attendance." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("roster")}>
      <RosterPage />
    </RequireRole>
  ),
});

const shiftTone = (s: string) => TONE_CLASS[CALENDAR_PALETTES.shiftType[s] ?? "inactive"];
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "2-digit" });

function RosterPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysYmd(week, i)), [week]);
  const data = useQuery({
    queryKey: ["roster-week", week], retry: false,
    queryFn: () => callEdgeFunction<RosterWeek>("get-roster-week", { week_start: week }),
  });
  const [draft, setDraft] = useState<RosterShift[] | null>(null);
  useEffect(() => setDraft(null), [week]);
  const shifts = draft ?? data.data?.shifts ?? [];
  const [pending, setPending] = useState<{ kind: "save" | "copy"; warnings: RosterWarning[]; count?: number | undefined } | null>(null);
  const [busy, setBusy] = useState(false);

  const times = data.data?.shift_times;
  const leaveOn = (u: string, d: string) => (data.data?.leaves ?? []).some((l) => l.user_id === u && l.from_date <= d && l.to_date >= d);
  const toggle = (u: string, d: string, s: ShiftType | "off") => {
    const cur = [...shifts];
    if (s === "off") { setDraft(cur.filter((x) => !(x.user_id === u && x.date === d && !x.checked_in_at))); return; }
    const i = cur.findIndex((x) => x.user_id === u && x.date === d && x.shift === s);
    if (i >= 0) { if (!cur[i]!.checked_in_at) cur.splice(i, 1); }
    else cur.push({ user_id: u, date: d, shift: s, start_time: times?.[s][0] ?? "08:00", end_time: times?.[s][1] ?? "14:00" });
    setDraft(cur);
  };

  const run = async (kind: "save" | "copy", confirm = false) => {
    setBusy(true);
    try {
      const res = kind === "save"
        ? await callEdgeFunction<SaveResult>("save-roster-shifts", { week_start: week, confirm, shifts: shifts.map(({ user_id, date, shift, start_time, end_time, ward_id, note }) => ({ user_id, date, shift, start_time, end_time, ward_id, note })) })
        : await callEdgeFunction<SaveResult>("copy-roster-week", { to_week: week, from_week: addDaysYmd(week, -7), confirm });
      if (res.needs_confirm) { setPending({ kind, warnings: res.warnings, count: res.count }); return; }
      setPending(null); setDraft(null);
      toast.success(kind === "save" ? t("roster.saved") : t("roster.copied"));
      if (res.warnings.length) toast.warning(t("roster.savedWithWarnings", { n: res.warnings.length }));
      await qc.invalidateQueries({ queryKey: ["roster-week", week] });
    } catch (e) { toast.error((e as { message?: string }).message ?? t("roster.failed")); } finally { setBusy(false); }
  };

  const warnFor = (u: string, d: string) => (data.data?.warnings ?? []).filter((w) => w.user_id === u && w.date === d);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t("roster.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("roster.desc")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" aria-label={t("roster.prevWeek")} onClick={() => setWeek(addDaysYmd(week, -7))}><ChevronLeft className="rtl:rotate-180" /></Button>
          <Button variant="outline" onClick={() => setWeek(mondayOf(new Date()))}>{t("roster.thisWeek")}</Button>
          <Button variant="outline" size="icon" aria-label={t("roster.nextWeek")} onClick={() => setWeek(addDaysYmd(week, 7))}><ChevronRight className="rtl:rotate-180" /></Button>
          <span className="text-sm font-medium"><Ltr>{fmtDay(days[0]!)} – {fmtDay(days[6]!)}</Ltr></span>
          <Button variant="outline" disabled={busy || !!draft} onClick={() => void run("copy")}><Copy /> {t("roster.copyLast")}</Button>
          <Button disabled={busy || !draft} onClick={() => void run("save")}><Save /> {t("roster.save")}</Button>
        </div>
      </div>

      {data.error && <Banner tone="danger" title={(data.error as { message?: string }).message ?? t("roster.failed")} />}
      {(data.data?.warnings.length ?? 0) > 0 && !draft && (
        <Banner tone="warning" title={t("roster.warningsTitle", { n: data.data!.warnings.length })}>
          <ul className="mt-1 list-disc ps-5 text-sm">{data.data!.warnings.slice(0, 6).map((w, i) => <li key={i}>{warnText(t, w)}</li>)}</ul>
        </Banner>
      )}

      <Tabs defaultValue="week">
        <TabsList>
          <TabsTrigger value="week">{t("roster.tabWeek")}</TabsTrigger>
          <TabsTrigger value="day">{t("roster.tabDay")}</TabsTrigger>
          <TabsTrigger value="attendance">{t("roster.tabAttendance")}</TabsTrigger>
        </TabsList>

        <TabsContent value="week" className="space-y-2">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {SHIFT_TYPES.map((s) => <span key={s} className={cn("rounded border-s-4 px-2 py-0.5", shiftTone(s))}>{t(`roster.shift.${s}`)} <Ltr>{times?.[s].join("–")}</Ltr></span>)}
            <span className="rounded bg-[repeating-linear-gradient(45deg,var(--muted),var(--muted)_4px,transparent_4px,transparent_8px)] px-2 py-0.5">{t("roster.onLeave")}</span>
          </div>
          {data.isLoading ? <Skeleton className="h-64 w-full" /> : (data.data?.staff.length ?? 0) === 0 ? <Banner tone="info" title={t("roster.noStaff")} /> : (
            <div className="overflow-x-auto rounded-staff border bg-card">
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr className="border-b bg-muted/40">
                  <th className="p-2 text-start font-medium">{t("roster.staff")}</th>
                  {days.map((d) => <th key={d} className="p-2 text-start font-medium"><Ltr>{fmtDay(d)}</Ltr></th>)}
                </tr></thead>
                <tbody>
                  {data.data!.staff.map((st) => (
                    <tr key={st.user_id} className="border-b last:border-0">
                      <td className="p-2 align-top">
                        <div className="font-medium">{st.name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{st.roles.filter((r) => r !== "patient").map((r) => t(`roles.${r}`, r)).join(", ")}</div>
                      </td>
                      {days.map((d) => {
                        const mine = shifts.filter((x) => x.user_id === st.user_id && x.date === d);
                        const leave = leaveOn(st.user_id, d);
                        const warns = draft ? [] : warnFor(st.user_id, d);
                        return (
                          <td key={d} className="p-1 align-top">
                            <Popover>
                              <PopoverTrigger asChild>
                                <button type="button" aria-label={`${st.name} ${d}`}
                                  className={cn("flex min-h-14 w-full flex-col gap-1 rounded-md border border-transparent p-1 text-start hover:border-border",
                                    leave && "bg-[repeating-linear-gradient(45deg,var(--muted),var(--muted)_4px,transparent_4px,transparent_8px)]",
                                    warns.length > 0 && "ring-2 ring-warning")}>
                                  {leave && <span className="text-[11px] font-medium text-warning-fg">{t("roster.onLeave")}</span>}
                                  {mine.map((x) => (
                                    <span key={x.shift} className={cn("rounded border-s-4 px-1.5 py-0.5 text-xs", shiftTone(x.shift))}>
                                      {t(`roster.shift.${x.shift}`)}{x.checked_in_at ? " ✓" : ""}
                                    </span>
                                  ))}
                                  {warns.length > 0 && <AlertTriangle className="size-3.5 text-warning-fg" aria-label={warns.map((w) => warnText(t, w)).join("; ")} />}
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-52 space-y-1 p-2">
                                {SHIFT_TYPES.map((s) => {
                                  const on = mine.some((x) => x.shift === s);
                                  return <Button key={s} size="sm" variant={on ? "default" : "outline"} className="w-full justify-between" onClick={() => toggle(st.user_id, d, s)}>
                                    {t(`roster.shift.${s}`)} <Ltr className="text-xs opacity-70">{times?.[s].join("–")}</Ltr></Button>;
                                })}
                                <Button size="sm" variant="ghost" className="w-full" onClick={() => toggle(st.user_id, d, "off")}>{t("roster.off")}</Button>
                                {leave && <p className="text-xs text-warning-fg">{t("roster.leaveHint")}</p>}
                              </PopoverContent>
                            </Popover>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {draft && <p className="text-sm text-muted-foreground">{t("roster.unsaved")}</p>}
        </TabsContent>

        <TabsContent value="day"><DayView data={data.data} shifts={shifts} week={week} /></TabsContent>
        <TabsContent value="attendance"><Attendance /></TabsContent>
      </Tabs>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("roster.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("roster.confirmBody")}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 list-disc space-y-1 overflow-y-auto ps-5 text-sm">
            {pending?.warnings.map((w, i) => <li key={i} className={w.kind === "leave" ? "font-medium text-warning-fg" : ""}>{warnText(t, w)}</li>)}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>{t("common.cancel")}</Button>
            <Button disabled={busy} onClick={() => pending && void run(pending.kind, true)}>{t("roster.saveAnyway")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import type { TFunction } from "i18next";
type TFn = TFunction;
function warnText(t: TFn, w: RosterWarning) {
  return t(`roster.warn.${w.kind}`, { name: w.name, date: w.date.split("-").reverse().join("/") });
}

function DayView({ data, shifts, week }: { data: RosterWeek | undefined; shifts: RosterShift[]; week: string }) {
  const { t } = useTranslation();
  const [date, setDate] = useState(() => new Date(`${week}T00:00:00`));
  const [view, setView] = useState<CalendarView>("byDoctor");
  useEffect(() => setDate(new Date(`${week}T00:00:00`)), [week]);
  const names = new Map((data?.staff ?? []).map((s) => [s.user_id, s.name]));
  const day = ymdLocal(date);
  const events: CalEvent[] = shifts.map((s) => {
    const sp = shiftSpan(s);
    return { id: `${s.user_id}-${s.date}-${s.shift}`, start: sp.start, end: sp.end, title: names.get(s.user_id) ?? "—", subtitle: t(`roster.shift.${s.shift}`),
      columnId: s.user_id, colorKey: s.shift, status: s.shift, draggable: false };
  });
  const onDay = new Set(shifts.filter((s) => s.date === day).map((s) => s.user_id));
  const columns: CalColumn[] = (data?.staff ?? []).filter((s) => onDay.has(s.user_id)).map((s) => ({
    id: s.user_id, label: s.name,
    blocked: (data?.leaves ?? []).some((l) => l.user_id === s.user_id && l.from_date <= day && l.to_date >= day)
      ? [{ start: new Date(`${day}T00:00:00`), end: new Date(`${day}T23:59:00`), label: t("roster.onLeave") }] : [],
  }));
  return <Calendar mode="shiftType" events={events} columns={columns} date={date} onDateChange={setDate} view={view} onViewChange={setView} startHour={0} endHour={24} slotMinutes={60} />;
}

interface AttRow { id: string; name: string; date: string; shift: ShiftType; start_time: string; end_time: string; checked_in_at: string | null; checked_out_at: string | null; status: string; late_min: number | null; early_min: number | null; worked_min: number | null }
const ATT_TONE: Record<string, "ok" | "warning" | "urgent" | "inactive" | "progress" | "caution"> = { present: "ok", late: "warning", absent: "urgent", on_leave: "caution", on_call: "progress", upcoming: "inactive" };
const hm = (s: string | null) => (s ? new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");

function Attendance() {
  const { t } = useTranslation();
  const today = ymdLocal(new Date());
  const [from, setFrom] = useState(addDaysYmd(today, -6));
  const [to, setTo] = useState(today);
  const rep = useQuery({
    queryKey: ["attendance", from, to], retry: false,
    queryFn: () => callEdgeFunction<{ rows: AttRow[]; totals: Record<string, number> }>("get-attendance-report", { from, to }),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="af">{t("dh.from")}</Label><Input id="af" type="date" dir="ltr" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div>
        <div className="space-y-1"><Label htmlFor="at">{t("dh.to")}</Label><Input id="at" type="date" dir="ltr" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(rep.data?.totals ?? {}).map(([k, n]) => <StatusChip key={k} status={ATT_TONE[k] ?? "inactive"}>{t(`roster.att.${k}`)} · <Ltr>{n}</Ltr></StatusChip>)}
        </div>
      </div>
      {rep.error && <Banner tone="danger" title={(rep.error as { message?: string }).message ?? t("roster.failed")} />}
      {rep.isLoading ? <Skeleton className="h-48 w-full" /> : (
        <div className="rounded-staff border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("roster.staff")}</TableHead><TableHead>{t("roster.date")}</TableHead><TableHead>{t("roster.shiftCol")}</TableHead>
              <TableHead>{t("roster.in")}</TableHead><TableHead>{t("roster.out")}</TableHead><TableHead>{t("roster.statusCol")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(rep.data?.rows ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("roster.noShifts")}</TableCell></TableRow>}
              {(rep.data?.rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Ltr>{r.date.split("-").reverse().join("/")}</Ltr></TableCell>
                  <TableCell>{t(`roster.shift.${r.shift}`)} <Ltr className="text-xs text-muted-foreground">{r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}</Ltr></TableCell>
                  <TableCell><Ltr>{hm(r.checked_in_at)}</Ltr>{r.late_min ? <span className="ms-1 text-xs text-warning-fg">+<Ltr>{r.late_min}</Ltr>m</span> : null}</TableCell>
                  <TableCell><Ltr>{hm(r.checked_out_at)}</Ltr>{r.early_min ? <span className="ms-1 text-xs text-warning-fg">−<Ltr>{r.early_min}</Ltr>m</span> : null}</TableCell>
                  <TableCell><StatusChip status={ATT_TONE[r.status] ?? "inactive"}>{t(`roster.att.${r.status}`)}</StatusChip></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
