/**
 * Dashboard widget registry: the only place widgets are defined.
 * The dashboard page, the widget library panel and the role checks all read from here.
 * get-dashboard-layout / save-dashboard-layout / get-widget-data must mirror ids + roles.
 */
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Activity, AlertTriangle, BedDouble, BedSingle, CalendarCheck, CalendarX, ClipboardList, Footprints, HandCoins,
  HeartPulse, ListOrdered, PiggyBank, ReceiptText, Siren, Stethoscope, TrendingUp, Users, Wallet, CalendarOff, Building2, Clock, Banknote, ClipboardPlus, Hourglass, Bug,
} from "lucide-react";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Ltr } from "@/components/mc/ltr";
import { formatPkr } from "@/lib/patient-summary";
import type { LucideIcon } from "lucide-react";
import { StatCard } from "@/components/mc/stat-card";
import type { AppRole } from "@/hooks/use-my-context";

export type WidgetSize = "small" | "medium" | "wide";
export const MAX_WIDGETS = 12;

export interface WidgetProps<T = unknown> {
  data: T;
  size: WidgetSize;
}

export interface WidgetDef {
  id: string;
  /** i18n key */
  title: string;
  /** i18n key */
  description: string;
  icon: LucideIcon;
  roles: AppRole[];
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
  component: ComponentType<WidgetProps<any>>;
}

export interface LayoutItem { id: string; size: WidgetSize }

interface CountData { value: number; previous?: number }

function trendProp(d: CountData): { trend?: number } {
  if (d.previous === undefined || d.previous === 0) return {};
  return { trend: Math.round(((d.value - d.previous) / d.previous) * 100) };
}

function ActiveUsers({ data }: WidgetProps<CountData>) {
  const { t } = useTranslation();
  return <StatCard label={t("dash.w.activeUsers")} value={data.value} {...trendProp(data)} icon={Users} caption={t("dash.w.activeUsersCap")} />;
}

function ErrorsToday({ data }: WidgetProps<CountData>) {
  const { t } = useTranslation();
  return <StatCard label={t("dash.w.errorsToday")} value={data.value} {...trendProp(data)} icon={AlertTriangle} goodWhen="down" caption={t("dash.w.errorsTodayCap")} />;
}

interface OccupancyData { total: number; occupied: number; free: number; cleaning: number; reserved: number; out_of_service: number }

function BedOccupancy({ data }: WidgetProps<OccupancyData>) {
  const { t } = useTranslation();
  const usable = data.total - data.out_of_service;
  const pct = usable > 0 ? Math.round((data.occupied / usable) * 100) : 0;
  return <StatCard label={t("dash.w.bedOccupancy")} value={`${pct}%`} icon={BedDouble}
    caption={t("dash.w.bedOccupancyCap", { occupied: data.occupied, total: usable, free: data.free, cleaning: data.cleaning })} />;
}

/** Card shell for list-style widgets. */
function Panel({ title, icon: Icon, children, action }: { title: string; icon: LucideIcon; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="h-full rounded-staff border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" aria-hidden />{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}
const Big = ({ children }: { children: React.ReactNode }) => <p className="text-3xl font-semibold tnum">{children}</p>;

function OpdToday({ data }: WidgetProps<CountData & { completed: number }>) {
  const { t } = useTranslation();
  return <StatCard label={t("dash.w.opdToday")} value={data.value} {...trendProp(data)} icon={Stethoscope} caption={t("dash.w.opdTodayCap", { done: data.completed })} />;
}

function ErWaiting({ data }: WidgetProps<{ waiting: number; avg_wait_min: number; longest_min: number; avg_door_to_doctor_min: number | null }>) {
  const { t } = useTranslation();
  return <StatCard label={t("dash.w.erWaiting")} value={t("dash.w.minutes", { n: data.avg_wait_min })} icon={Siren}
    caption={t("dash.w.erWaitingCap", { n: data.waiting, longest: data.longest_min, d2d: data.avg_door_to_doctor_min ?? "—" })} />;
}

function CashVsUnpaid({ data, size }: WidgetProps<{ collected: number; unpaid: number; unpaid_bills: number }>) {
  const { t } = useTranslation();
  const total = data.collected + data.unpaid;
  const pct = total > 0 ? Math.round((data.collected / total) * 100) : 0;
  return (
    <Panel title={t("dash.w.cashVsUnpaid")} icon={HandCoins}>
      <div className={size === "small" ? "space-y-2" : "grid grid-cols-2 gap-4"}>
        <div><p className="text-xs text-muted-foreground">{t("dash.w.collected")}</p><p className="text-xl font-semibold text-ok-fg"><Ltr>{formatPkr(data.collected)}</Ltr></p></div>
        <div><p className="text-xs text-muted-foreground">{t("dash.w.unpaidNow", { n: data.unpaid_bills })}</p><p className="text-xl font-semibold text-urgent-fg"><Ltr>{formatPkr(data.unpaid)}</Ltr></p></div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-urgent-soft" role="img" aria-label={`${pct}%`}>
        <div className="h-full bg-ok" style={{ width: `${pct}%` }} />
      </div>
    </Panel>
  );
}

function AdmDisTrend({ data }: WidgetProps<{ days: { date: string; admissions: number; discharges: number }[] }>) {
  const { t } = useTranslation();
  const config = {
    admissions: { label: t("dash.w.admissions"), color: "var(--chart-1)" },
    discharges: { label: t("dash.w.discharges"), color: "var(--chart-2)" },
  } satisfies ChartConfig;
  const rows = data.days.map((d) => ({ ...d, label: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}` }));
  return (
    <Panel title={t("dash.w.admDisTrend")} icon={TrendingUp}>
      <ChartContainer config={config} className="h-56 w-full" dir="ltr">
        <BarChart data={rows} margin={{ left: -20, right: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="admissions" fill="var(--color-admissions)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="discharges" fill="var(--color-discharges)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </Panel>
  );
}

function TokenQueue({ data }: WidgetProps<{ waiting: number; in_consultation: number; doctors: { doctor: string; waiting: number; current: number | null }[] }>) {
  const { t } = useTranslation();
  return (
    <Panel title={t("dash.w.tokenQueue")} icon={ListOrdered} action={<Link to="/opd-queue" className="text-xs font-medium hover:underline">{t("dash.w.open")}</Link>}>
      <Big><Ltr>{data.waiting}</Ltr></Big>
      <p className="mb-2 text-xs text-muted-foreground">{t("dash.w.tokenQueueCap", { n: data.in_consultation })}</p>
      <ul className="divide-y text-sm">
        {data.doctors.map((d, i) => (
          <li key={i} className="flex justify-between py-1.5"><span className="truncate">{d.doctor}</span>
            <span className="text-muted-foreground">{d.current != null && <>{t("dash.w.now")} <Ltr>#{d.current}</Ltr> · </>}<Ltr>{d.waiting}</Ltr> {t("dash.w.waiting")}</span></li>
        ))}
      </ul>
    </Panel>
  );
}

function AppointmentsToday({ data }: WidgetProps<{ total: number; by_status: Record<string, number> }>) {
  const { t } = useTranslation();
  const b = data.by_status;
  return <StatCard label={t("dash.w.appointmentsToday")} value={data.total} icon={CalendarCheck}
    caption={t("dash.w.appointmentsTodayCap", { booked: b['booked'] ?? 0, waiting: (b['waiting'] ?? 0) + (b['in_consultation'] ?? 0), done: b['done'] ?? 0 })} />;
}
function WalkIns({ data }: WidgetProps<CountData>) {
  const { t } = useTranslation();
  return <StatCard label={t("dash.w.walkIns")} value={data.value} {...trendProp(data)} icon={Footprints} caption={t("dash.w.vsPrevious")} />;
}
function NoShows({ data }: WidgetProps<CountData>) {
  const { t } = useTranslation();
  return <StatCard label={t("dash.w.noShows")} value={data.value} {...trendProp(data)} icon={CalendarX} goodWhen="down" caption={t("dash.w.vsPrevious")} />;
}

interface QueueData { current: { token: number; name: string } | null; next: { token: number; name: string; waited_min: number }[]; waiting: number; avg_wait_min: number; longest_min: number }
function MyQueue({ data }: WidgetProps<QueueData>) {
  const { t } = useTranslation();
  return (
    <Panel title={t("dash.w.myQueue")} icon={ListOrdered} action={<Link to="/my-day" className="text-xs font-medium hover:underline">{t("dash.w.open")}</Link>}>
      <p className="text-xs text-muted-foreground">{t("dash.w.now")}</p>
      <p className="mb-2 text-lg font-semibold">{data.current ? <><Ltr>#{data.current.token}</Ltr> {data.current.name}</> : "—"}</p>
      {data.next.length === 0 ? <p className="text-sm text-muted-foreground">{t("dash.w.queueEmpty")}</p> : (
        <ul className="divide-y text-sm">
          {data.next.map((n) => <li key={n.token} className="flex justify-between py-1.5"><span><Ltr>#{n.token}</Ltr> {n.name}</span><span className="text-muted-foreground">{t("dash.w.minutes", { n: n.waited_min })}</span></li>)}
        </ul>
      )}
    </Panel>
  );
}
function WaitingPatients({ data }: WidgetProps<QueueData>) {
  const { t } = useTranslation();
  return <StatCard label={t("dash.w.waitingPatients")} value={data.waiting} icon={Users} goodWhen="down"
    caption={t("dash.w.waitingPatientsCap", { avg: data.avg_wait_min, longest: data.longest_min })} />;
}
function MyAdmitted({ data }: WidgetProps<{ count: number; patients: { patient_id: string; name: string; mrn: string; bed: string; days: number }[] }>) {
  const { t } = useTranslation();
  return (
    <Panel title={t("dash.w.myAdmitted")} icon={BedSingle}>
      <Big><Ltr>{data.count}</Ltr></Big>
      <ul className="mt-2 divide-y text-sm">
        {data.patients.map((p) => (
          <li key={p.patient_id} className="flex justify-between gap-2 py-1.5">
            <Link to="/patients/$patientId" params={{ patientId: p.patient_id }} className="truncate hover:underline">{p.name}</Link>
            <span className="text-muted-foreground"><Ltr>{p.bed}</Ltr> · {t("dash.w.days", { n: p.days })}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CriticalResults({ data }: WidgetProps<{ count: number; results: { order_id: string; patient_id: string; name: string; mrn: string; test: string; summary: string; verified_at: string }[] }>) {
  const { t } = useTranslation();
  return (
    <Panel title={t("dash.w.criticalResults")} icon={AlertTriangle}>
      <Big><span className={data.count ? "text-destructive" : ""}><Ltr>{data.count}</Ltr></span></Big>
      {data.count === 0 ? <p className="text-sm text-muted-foreground">{t("dash.w.noCritical")}</p> : (
        <ul className="mt-2 divide-y text-sm">
          {data.results.map((r) => (
            <li key={r.order_id} className="py-1.5">
              <div className="flex justify-between gap-2">
                <Link to="/patients/$patientId" params={{ patientId: r.patient_id }} className="truncate font-medium hover:underline">{r.name}</Link>
                <Ltr className="text-muted-foreground">{r.test}</Ltr>
              </div>
              <Ltr className="block truncate text-xs text-destructive">{r.summary}</Ltr>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function WardBeds({ data }: WidgetProps<OccupancyData & { no_wards?: boolean; wards?: number }>) {
  const { t } = useTranslation();
  if (data.no_wards) return <Panel title={t("dash.w.wardBeds")} icon={BedDouble}><p className="text-sm text-muted-foreground">{t("dash.w.noWards")}</p></Panel>;
  const cells: [string, number, string][] = [["occupied", data.occupied, "bg-progress-soft text-progress-fg"], ["free", data.free, "bg-ok-soft text-ok-fg"], ["cleaning", data.cleaning, "bg-warning-soft text-warning-fg"], ["reserved", data.reserved, "bg-muted"]];
  return (
    <Panel title={t("dash.w.wardBeds")} icon={BedDouble} action={<Link to="/nursing" className="text-xs font-medium hover:underline">{t("dash.w.open")}</Link>}>
      <div className="grid grid-cols-4 gap-2">
        {cells.map(([k, n, cls]) => <div key={k} className={`rounded-staff p-2 text-center ${cls}`}><p className="text-xl font-semibold"><Ltr>{n}</Ltr></p><p className="text-xs">{t(`wd.statuses.${k}`, k)}</p></div>)}
      </div>
    </Panel>
  );
}
function VitalsDue({ data }: WidgetProps<{ no_wards?: boolean; due: number; patients: { name: string; bed: string; last_min: number | null }[] }>) {
  const { t } = useTranslation();
  return (
    <Panel title={t("dash.w.vitalsDue")} icon={HeartPulse}>
      {data.no_wards ? <p className="text-sm text-muted-foreground">{t("dash.w.noWards")}</p> : <>
        <Big><span className={data.due ? "text-urgent-fg" : ""}><Ltr>{data.due}</Ltr></span></Big>
        <ul className="mt-2 divide-y text-sm">
          {data.patients.map((p, i) => (
            <li key={i} className="flex justify-between py-1.5"><span className="truncate"><Ltr>{p.bed}</Ltr> · {p.name}</span>
              <span className="text-muted-foreground">{p.last_min == null ? t("dash.w.neverRecorded") : t("dash.w.hoursAgo", { n: Math.floor(p.last_min / 60) })}</span></li>
          ))}
        </ul>
      </>}
    </Panel>
  );
}

function ShiftCash({ data }: WidgetProps<{ open: boolean; taken?: number; paid_out?: number; expected?: number }>) {
  const { t } = useTranslation();
  if (!data.open) return (
    <Panel title={t("dash.w.shiftCash")} icon={Wallet}>
      <p className="text-sm text-muted-foreground">{t("dash.w.noShift")}</p>
      <Link to="/cash-register" className="mt-2 inline-block text-sm font-medium hover:underline">{t("shift.open")}</Link>
    </Panel>
  );
  return <StatCard label={t("dash.w.shiftCash")} value={formatPkr(data.expected ?? 0)} icon={Wallet}
    caption={t("dash.w.shiftCashCap", { in: formatPkr(data.taken ?? 0), out: formatPkr(data.paid_out ?? 0) })} />;
}
function PendingBills({ data }: WidgetProps<{ count: number; amount: number; over_30: number }>) {
  const { t } = useTranslation();
  return <StatCard label={t("dash.w.pendingBills")} value={formatPkr(data.amount)} icon={ReceiptText}
    caption={t("dash.w.pendingBillsCap", { n: data.count, old: data.over_30 })} />;
}
function DepositsSummary({ data }: WidgetProps<{ value: number; count: number; held: number }>) {
  const { t } = useTranslation();
  return <StatCard label={t("dash.w.deposits")} value={formatPkr(data.value)} icon={PiggyBank}
    caption={t("dash.w.depositsCap", { n: data.count, held: formatPkr(data.held) })} />;
}

// department head (data scoped server-side to the caller's own department)
type NoDept = { no_department?: boolean };
function NoDeptNote({ title, icon }: { title: string; icon: LucideIcon }) {
  const { t } = useTranslation();
  return <Panel title={title} icon={icon}><p className="text-sm text-muted-foreground">{t("dh.noDepartment")}</p></Panel>;
}
function DeptOpdByDoctor({ data }: WidgetProps<NoDept & { department?: string; doctors?: { name: string; opd: number; done: number }[] }>) {
  const { t } = useTranslation();
  if (data.no_department) return <NoDeptNote title={t("dash.w.deptOpd")} icon={Building2} />;
  const docs = data.doctors ?? [];
  const max = Math.max(1, ...docs.map((d) => d.opd));
  return (
    <Panel title={t("dash.w.deptOpd")} icon={Building2} action={<Link to="/reports" className="text-xs font-medium hover:underline">{t("dash.w.open")}</Link>}>
      {docs.length === 0 ? <p className="text-sm text-muted-foreground">{t("dh.noDoctors")}</p> : (
        <ul className="space-y-2 text-sm">
          {docs.map((d, i) => (
            <li key={i}>
              <div className="flex justify-between gap-2"><span className="truncate">{d.name || "—"}</span><span className="text-muted-foreground"><Ltr>{d.opd}</Ltr> · {t("dash.w.doneN", { n: d.done })}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${(d.opd / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
function DeptWaitingNow({ data }: WidgetProps<NoDept & { waiting?: number; avg_wait_min?: number; longest_min?: number }>) {
  const { t } = useTranslation();
  if (data.no_department) return <NoDeptNote title={t("dash.w.deptWaiting")} icon={Hourglass} />;
  return <StatCard label={t("dash.w.deptWaiting")} value={data.waiting ?? 0} icon={Hourglass} goodWhen="down"
    caption={t("dash.w.waitingPatientsCap", { avg: data.avg_wait_min ?? 0, longest: data.longest_min ?? 0 })} />;
}
function DeptAdmissions({ data }: WidgetProps<NoDept & { current?: number; admitted?: number; discharged?: number }>) {
  const { t } = useTranslation();
  if (data.no_department) return <NoDeptNote title={t("dash.w.deptAdmissions")} icon={ClipboardPlus} />;
  return <StatCard label={t("dash.w.deptAdmissions")} value={data.current ?? 0} icon={ClipboardPlus}
    caption={t("dash.w.deptAdmissionsCap", { a: data.admitted ?? 0, d: data.discharged ?? 0 })} />;
}
function DeptTopDiagnoses({ data }: WidgetProps<NoDept & { items?: { code: string; description: string; count: number }[] }>) {
  const { t } = useTranslation();
  if (data.no_department) return <NoDeptNote title={t("dash.w.deptDiagnoses")} icon={Stethoscope} />;
  const items = data.items ?? [];
  return (
    <Panel title={t("dash.w.deptDiagnoses")} icon={Stethoscope}>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{t("dh.noData")}</p> : (
        <ol className="divide-y text-sm">
          {items.map((d, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span className="truncate"><Ltr className="me-1 font-medium">{d.code}</Ltr>{d.description}</span><Ltr className="text-muted-foreground">{d.count}</Ltr></li>)}
        </ol>
      )}
    </Panel>
  );
}
function DeptRevenue({ data }: WidgetProps<NoDept & CountData>) {
  const { t } = useTranslation();
  if (data.no_department) return <NoDeptNote title={t("dash.w.deptRevenue")} icon={Banknote} />;
  return <StatCard label={t("dash.w.deptRevenue")} value={formatPkr(data.value ?? 0)} {...trendProp(data)} icon={Banknote} caption={t("dash.w.vsPrevious")} />;
}
function DeptOnLeave({ data }: WidgetProps<NoDept & { count?: number; pending?: number; doctors?: { name: string; to_date: string }[] }>) {
  const { t } = useTranslation();
  if (data.no_department) return <NoDeptNote title={t("dash.w.deptOnLeave")} icon={CalendarOff} />;
  const docs = data.doctors ?? [];
  return (
    <Panel title={t("dash.w.deptOnLeave")} icon={CalendarOff} action={<Link to="/leave-approvals" className="text-xs font-medium hover:underline">{t("dash.w.pendingLeave", { n: data.pending ?? 0 })}</Link>}>
      <Big><Ltr>{data.count ?? 0}</Ltr></Big>
      <ul className="mt-2 divide-y text-sm">
        {docs.map((d, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span className="truncate">{d.name}</span><span className="text-muted-foreground">{t("dash.w.backAfter")} <Ltr>{d.to_date.split("-").reverse().join("/")}</Ltr></span></li>)}
      </ul>
    </Panel>
  );
}

interface DutyShift { id: string; date: string; shift: string; start_time: string; end_time: string; checked_in_at: string | null; checked_out_at: string | null }
function MyDuty({ data }: WidgetProps<{ shifts: DutyShift[] }>) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const act = async (fn: "check-in-duty" | "check-out-duty", id: string) => {
    setBusy(true);
    try {
      const r = await callEdgeFunction<{ late_min?: number; early_min?: number }>(fn, { shift_id: id });
      toast.success(fn === "check-in-duty" ? (r.late_min && r.late_min > 15 ? t("roster.checkedInLate", { n: r.late_min }) : t("roster.checkedIn")) : t("roster.checkedOut"));
      await qc.invalidateQueries({ queryKey: ["widget-data", "my_duty"] });
    } catch (e) { toast.error((e as { message?: string }).message ?? t("roster.failed")); } finally { setBusy(false); }
  };
  return (
    <Panel title={t("dash.w.myDuty")} icon={Clock}>
      {data.shifts.length === 0 ? <p className="text-sm text-muted-foreground">{t("roster.noDutyToday")}</p> : (
        <ul className="divide-y text-sm">
          {data.shifts.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2">
              <span><span className="font-medium">{t(`roster.shift.${s.shift}`)}</span> <Ltr className="text-muted-foreground">{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</Ltr></span>
              {!s.checked_in_at ? <Button size="sm" disabled={busy} onClick={() => void act("check-in-duty", s.id)}>{t("roster.checkIn")}</Button>
                : !s.checked_out_at ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("check-out-duty", s.id)}>{t("roster.checkOut")}</Button>
                : <span className="text-xs text-ok-fg">{t("roster.done")}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SurgeWatch({ data }: WidgetProps<{ items: { group: string; count: number; baseline: number; surge: boolean }[]; surges: number }>) {
  const { t } = useTranslation();
  return (
    <Panel title={t("dash.w.surgeWatch")} icon={Bug} action={<Link to="/surveillance" className="text-xs text-primary hover:underline">{t("surv.open")}</Link>}>
      <p className="mb-2 text-sm">{data.surges ? <span className="font-semibold text-urgent">{t("surv.surgeCount", { count: data.surges })}</span> : <span className="text-muted-foreground">{t("surv.noSurge")}</span>}</p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {data.items.map((i) => (
          <li key={i.group} className={i.surge ? "flex justify-between font-semibold text-urgent" : "flex justify-between"}>
            <span>{t(`surv.g.${i.group}`)}</span><Ltr className="tnum">{i.count}<span className="text-xs text-muted-foreground"> / {i.baseline}</span></Ltr>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const ALL_SIZES: WidgetSize[] = ["small", "medium", "wide"];
const w = (id: string, key: string, icon: LucideIcon, roles: AppRole[], defaultSize: WidgetSize, component: ComponentType<WidgetProps<any>>, sizes = ALL_SIZES): WidgetDef =>
  ({ id, title: `dash.w.${key}`, description: `dash.w.${key}Desc`, icon, roles, sizes, defaultSize, component });

export const WIDGETS: WidgetDef[] = [
  {
    id: "bed_occupancy", title: "dash.w.bedOccupancy", description: "dash.w.bedOccupancyDesc", icon: BedDouble,
    roles: ["super_admin", "admin", "nurse", "dept_head", "receptionist", "er_officer"], sizes: ["small", "medium", "wide"], defaultSize: "small", component: BedOccupancy,
  },
  {
    id: "active_users", title: "dash.w.activeUsers", description: "dash.w.activeUsersDesc", icon: Users,
    roles: ["super_admin", "admin"], sizes: ["small", "medium", "wide"], defaultSize: "small", component: ActiveUsers,
  },
  {
    id: "errors_today", title: "dash.w.errorsToday", description: "dash.w.errorsTodayDesc", icon: AlertTriangle,
    roles: ["super_admin"], sizes: ["small", "medium", "wide"], defaultSize: "small", component: ErrorsToday,
  },
  // admin
  w("opd_today", "opdToday", Stethoscope, ["super_admin", "admin", "dept_head"], "small", OpdToday),
  w("er_waiting", "erWaiting", Siren, ["super_admin", "admin", "er_officer", "dept_head"], "small", ErWaiting),
  w("cash_vs_unpaid", "cashVsUnpaid", HandCoins, ["super_admin", "admin"], "small", CashVsUnpaid),
  w("surge_watch", "surgeWatch", Bug, ["super_admin", "admin"], "medium", SurgeWatch, ["medium", "wide"]),
  w("adm_dis_trend", "admDisTrend", TrendingUp, ["super_admin", "admin", "dept_head"], "wide", AdmDisTrend, ["medium", "wide"]),
  // reception
  w("token_queue", "tokenQueue", ListOrdered, ["super_admin", "admin", "receptionist"], "medium", TokenQueue, ["medium", "wide"]),
  w("appointments_today", "appointmentsToday", CalendarCheck, ["super_admin", "admin", "receptionist"], "small", AppointmentsToday),
  w("walk_ins", "walkIns", Footprints, ["super_admin", "admin", "receptionist"], "small", WalkIns),
  w("no_shows", "noShows", CalendarX, ["super_admin", "admin", "receptionist"], "small", NoShows),
  // doctor
  w("my_queue", "myQueue", ClipboardList, ["doctor"], "medium", MyQueue, ["medium", "wide"]),
  w("waiting_patients", "waitingPatients", Activity, ["doctor"], "small", WaitingPatients),
  w("my_admitted", "myAdmitted", BedSingle, ["doctor"], "medium", MyAdmitted, ["medium", "wide"]),
  w("critical_results", "criticalResults", AlertTriangle, ["doctor"], "medium", CriticalResults, ["medium", "wide"]),
  // nurse
  w("ward_beds", "wardBeds", BedDouble, ["nurse"], "medium", WardBeds, ["medium", "wide"]),
  w("vitals_due", "vitalsDue", HeartPulse, ["nurse"], "medium", VitalsDue, ["medium", "wide"]),
  // cashier
  w("shift_cash", "shiftCash", Wallet, ["cashier", "admin", "super_admin"], "small", ShiftCash),
  w("pending_bills", "pendingBills", ReceiptText, ["cashier", "admin", "super_admin"], "small", PendingBills),
  w("deposits_summary", "deposits", PiggyBank, ["cashier", "admin", "super_admin"], "small", DepositsSummary),
  w("my_duty", "myDuty", Clock, ["super_admin", "admin", "dept_head", "doctor", "nurse", "er_officer", "ot_coordinator", "receptionist", "pharmacist", "lab_tech", "cashier"], "medium", MyDuty, ["small", "medium", "wide"]),
  // department head
  w("dept_opd_by_doctor", "deptOpd", Building2, ["dept_head"], "medium", DeptOpdByDoctor, ["medium", "wide"]),
  w("dept_waiting_now", "deptWaiting", Hourglass, ["dept_head"], "small", DeptWaitingNow),
  w("dept_admissions", "deptAdmissions", ClipboardPlus, ["dept_head"], "small", DeptAdmissions),
  w("dept_top_diagnoses", "deptDiagnoses", Stethoscope, ["dept_head"], "medium", DeptTopDiagnoses, ["medium", "wide"]),
  w("dept_revenue", "deptRevenue", Banknote, ["dept_head"], "small", DeptRevenue),
  w("dept_on_leave", "deptOnLeave", CalendarOff, ["dept_head"], "medium", DeptOnLeave, ["medium", "wide"]),
];

export const findWidget = (id: string) => WIDGETS.find((w) => w.id === id);

export function widgetsForRoles(roles: AppRole[]) {
  return WIDGETS.filter((w) => w.roles.some((r) => roles.includes(r)));
}

/** Fallback when company settings have no role default (the server applies the same rule). */
export const CODE_DEFAULTS: Partial<Record<AppRole, LayoutItem[]>> = {
  super_admin: [{ id: "active_users", size: "small" }, { id: "errors_today", size: "small" }, { id: "bed_occupancy", size: "small" }, { id: "opd_today", size: "small" }, { id: "adm_dis_trend", size: "wide" }],
  admin: [{ id: "bed_occupancy", size: "small" }, { id: "opd_today", size: "small" }, { id: "er_waiting", size: "small" }, { id: "cash_vs_unpaid", size: "small" }, { id: "adm_dis_trend", size: "wide" }],
  receptionist: [{ id: "token_queue", size: "medium" }, { id: "appointments_today", size: "small" }, { id: "walk_ins", size: "small" }, { id: "no_shows", size: "small" }],
  doctor: [{ id: "my_queue", size: "medium" }, { id: "waiting_patients", size: "small" }, { id: "my_admitted", size: "medium" }, { id: "critical_results", size: "medium" }],
  nurse: [{ id: "ward_beds", size: "medium" }, { id: "vitals_due", size: "medium" }],
  cashier: [{ id: "shift_cash", size: "small" }, { id: "pending_bills", size: "small" }, { id: "deposits_summary", size: "small" }],
  er_officer: [{ id: "er_waiting", size: "small" }, { id: "bed_occupancy", size: "small" }],
  dept_head: [{ id: "dept_opd_by_doctor", size: "medium" }, { id: "dept_waiting_now", size: "small" }, { id: "dept_revenue", size: "small" }, { id: "dept_admissions", size: "small" }, { id: "dept_on_leave", size: "medium" }, { id: "dept_top_diagnoses", size: "medium" }],
};

export function defaultLayoutFor(roles: AppRole[], overrides?: Partial<Record<string, LayoutItem[]>>): LayoutItem[] {
  const seen = new Set<string>();
  const out: LayoutItem[] = [];
  for (const r of roles) for (const item of overrides?.[r] ?? CODE_DEFAULTS[r] ?? []) {
    if (!seen.has(item.id)) { seen.add(item.id); out.push(item); }
  }
  return out.slice(0, MAX_WIDGETS);
}

export const SIZE_CLASS: Record<WidgetSize, string> = {
  small: "lg:col-span-1",
  medium: "lg:col-span-2",
  wide: "lg:col-span-4",
};
