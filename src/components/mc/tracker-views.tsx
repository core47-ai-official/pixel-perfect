import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bell, CalendarClock, Pill, Stethoscope, Activity, Thermometer } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { firstName, pkDay, pkTime } from "@/lib/portal";
import { formatReading, QUICK_TYPES, type Measurement, type MType } from "@/lib/measurements";
import { dailySeries, lastDays, summarize, useTimeline, useTrendData, type TimelineKind } from "@/lib/trends";
import { cn } from "@/lib/utils";

interface Dash {
  name: string | null;
  readings: Measurement[];
  symptoms: { id: string; symptom: string; severity: number; started_at: string }[];
  doses: { id: string; due_at: string; status: string | null; name: string; dose: string | null }[];
  next_appointment: { id: string; slot_start: string; token_no: number | null; doctor_name: string | null; department_name: string | null } | null;
  alerts: { id: string; title: string; body: string | null; created_at: string; read_at: string | null }[];
}

export function TrackerToday() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ["tracker-dashboard"], queryFn: () => callEdgeFunction<Dash>("get-tracker-dashboard", {}) });
  if (q.isLoading) return <Skeleton className="h-40 rounded-patient" />;
  if (q.isError || !q.data) return <Banner tone="danger" title={t("trd.loadFailed")} />;
  const d = q.data;
  const hour = Number(pkTime(new Date().toISOString()).slice(0, 2));
  const greet = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const taken = d.doses.filter((x) => x.status === "taken").length;
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">{t(`trd.greet_${greet}`, { name: firstName(d.name) })}</h1>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <PCard className="space-y-1 p-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Activity className="size-3.5" aria-hidden />{t("trd.todayReadings")}</p>
          {d.readings.length ? d.readings.slice(0, 3).map((r) => <p key={r.id} className="text-sm"><span className="text-muted-foreground">{t(`meas.t.${r.type}`)}</span> <Ltr className="font-medium">{formatReading(r)}</Ltr></p>)
            : <p className="text-sm text-muted-foreground">{t("trd.nothingYet")}</p>}
        </PCard>
        <PCard className="space-y-1 p-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Thermometer className="size-3.5" aria-hidden />{t("trd.todaySymptoms")}</p>
          {d.symptoms.length ? d.symptoms.slice(0, 3).map((s) => <p key={s.id} className="text-sm"><Ltr>{s.symptom}</Ltr> <Ltr className="text-muted-foreground">{s.severity}/10</Ltr></p>)
            : <p className="text-sm text-muted-foreground">{t("trd.noSymptoms")}</p>}
        </PCard>
        <Link to="/portal/medicines" className="col-span-2 sm:col-span-1">
          <PCard className="h-full space-y-1 p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Pill className="size-3.5" aria-hidden />{t("trd.todayDoses")}</p>
            {d.doses.length ? <p className="text-sm"><Ltr className="text-lg font-semibold">{taken}/{d.doses.length}</Ltr> {t("trd.dosesTaken")}</p>
              : <p className="text-sm text-muted-foreground">{t("meds.noneToday")}</p>}
            {d.doses.find((x) => !x.status) && <p className="text-xs text-muted-foreground">{t("trd.nextDose")} <Ltr>{pkTime(d.doses.find((x) => !x.status)!.due_at)}</Ltr></p>}
          </PCard>
        </Link>
      </div>
      <PCard className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        {d.next_appointment ? (
          <div className="text-sm">
            <p className="font-medium">{t("portal.nextAppt")}</p>
            <p><Ltr>{pkDay(d.next_appointment.slot_start)} {pkTime(d.next_appointment.slot_start)}</Ltr>{d.next_appointment.doctor_name ? <> · {d.next_appointment.doctor_name}</> : null}</p>
            {d.next_appointment.token_no != null && <p className="text-muted-foreground">{t("portal.token")} <Ltr>{d.next_appointment.token_no}</Ltr></p>}
          </div>
        ) : <p className="text-sm text-muted-foreground">{t("portal.noNextAppt")}</p>}
      </PCard>
      {d.alerts.length > 0 && (
        <PCard>
          <p className="mb-1 flex items-center gap-2 font-medium"><Bell className="size-4" aria-hidden />{t("trd.alerts")}</p>
          <ul className="divide-y">{d.alerts.map((a) => (
            <li key={a.id} className="py-1.5 text-sm"><p className={cn(!a.read_at && "font-medium")}>{a.title}</p><p className="text-xs text-muted-foreground"><Ltr>{pkDay(a.created_at)} {pkTime(a.created_at)}</Ltr></p></li>
          ))}</ul>
        </PCard>
      )}
    </div>
  );
}

const RANGES = [7, 30, 90] as const;

export function TrendsView() {
  const { t } = useTranslation();
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const q = useTrendData(days);
  const dayList = useMemo(() => lastDays(days), [days]);
  return (
    <div className="space-y-3">
      <div className="flex gap-2" role="group" aria-label={t("trd.range")}>
        {RANGES.map((n) => (
          <button key={n} type="button" onClick={() => setDays(n)} aria-pressed={days === n}
            className={cn("rounded-full border px-4 py-1.5 text-sm", days === n ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
            {t("trd.days", { count: n })}
          </button>
        ))}
      </div>
      {q.isLoading ? <Skeleton className="h-56 rounded-patient" /> : q.isError || !q.data ? <Banner tone="danger" title={t("trd.loadFailed")} /> : (
        QUICK_TYPES.map((type) => <TrendCard key={type} type={type} days={dayList} rows={q.data.rows.filter((r) => (r as { type?: string }).type === type)} target={q.data.targets[type]} />)
      )}
      <p className="text-xs text-muted-foreground">{t("trd.notAdvice")}</p>
    </div>
  );
}

function TrendCard({ type, days, rows, target }: { type: MType; days: string[]; rows: Pick<Measurement, "value_1" | "value_2" | "measured_at">[]; target?: { low?: number | null; high?: number | null; low_2?: number | null; high_2?: number | null } }) {
  const { t } = useTranslation();
  const pts = dailySeries(rows, days, target);
  const s = summarize(pts);
  const unit = { bp: "mmHg", glucose: "mg/dL", weight: "kg", temp: "°C", pulse: "bpm", spo2: "%" }[type];
  const config: ChartConfig = { v1: { label: type === "bp" ? t("trd.systolic") : t(`meas.t.${type}`), color: "var(--primary)" }, v2: { label: t("trd.diastolic"), color: "var(--muted-foreground)" } };
  const avg = s.avg1 == null ? "" : type === "bp" ? `${s.avg1}/${s.avg2 ?? "—"}` : String(s.avg1);
  const sentence = !s.logged ? t("trd.sumNone", { days: s.days })
    : s.hasTarget ? t("trd.sumRange", { measure: t(`meas.t.${type}`), n: s.inRange, logged: s.logged })
    : t("trd.sumAvg", { measure: t(`meas.t.${type}`), n: s.logged, days: s.days, avg, unit });
  return (
    <PCard className="space-y-2" data-testid={`trend-${type}`}>
      <div className="flex items-baseline justify-between"><p className="font-medium">{t(`meas.t.${type}`)}</p><Ltr className="text-xs text-muted-foreground">{unit}</Ltr></div>
      <p className="text-sm" data-testid={`trend-summary-${type}`}>{sentence}</p>
      {s.logged > 0 && (
        <ChartContainer config={config} className="aspect-auto h-40 w-full" dir="ltr">
          <LineChart data={pts} margin={{ left: -16, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} domain={["auto", "auto"]} width={44} />
            {target && (target.low != null || target.high != null) && <ReferenceArea y1={target.low ?? undefined} y2={target.high ?? undefined} fill="var(--primary)" fillOpacity={0.1} strokeOpacity={0} ifOverflow="extendDomain" />}
            {type === "bp" && target && (target.low_2 != null || target.high_2 != null) && <ReferenceArea y1={target.low_2 ?? undefined} y2={target.high_2 ?? undefined} fill="var(--muted-foreground)" fillOpacity={0.08} strokeOpacity={0} ifOverflow="extendDomain" />}
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line dataKey="v1" type="monotone" stroke="var(--color-v1)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            {type === "bp" && <Line dataKey="v2" type="monotone" stroke="var(--color-v2)" strokeWidth={2} dot={{ r: 3 }} connectNulls />}
          </LineChart>
        </ChartContainer>
      )}
      {target && <p className="text-xs text-muted-foreground">{t("trd.targetNote")}</p>}
    </PCard>
  );
}

const KINDS: TimelineKind[] = ["reading", "symptom", "dose", "appointment", "diagnosis"];

export function TimelineView() {
  const { t } = useTranslation();
  const q = useTimeline();
  const [on, setOn] = useState<Set<TimelineKind>>(new Set(KINDS));
  const toggle = (k: TimelineKind) => setOn((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const items = (q.data ?? []).filter((i) => on.has(i.kind));
  let lastDay = "";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={on.has(k)} onClick={() => toggle(k)}
            className={cn("rounded-full border px-3 py-1 text-sm", on.has(k) ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground")}>{t(`trd.k_${k}`)}</button>
        ))}
      </div>
      {q.isLoading ? <Skeleton className="h-56 rounded-patient" /> : q.isError ? <Banner tone="danger" title={t("trd.loadFailed")} /> : !items.length ? <PCard><p className="text-sm text-muted-foreground">{t("trd.timelineEmpty")}</p></PCard> : (
        <PCard>
          <ol className="space-y-1">
            {items.map((i) => {
              const day = pkDay(i.at); const head = day !== lastDay; lastDay = day;
              return (
                <li key={i.id}>
                  {head && <p className="pt-2 text-xs font-medium text-muted-foreground"><Ltr>{day}</Ltr></p>}
                  <div className="flex items-center gap-3 py-1.5 text-sm">
                    <Ltr className="w-12 shrink-0 text-xs text-muted-foreground">{pkTime(i.at)}</Ltr>
                    {i.kind === "diagnosis" && <Stethoscope className="size-4 shrink-0 text-primary" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="text-muted-foreground">{t(`trd.k_${i.kind}`)} · </span>
                      {i.kind === "reading" ? <>{t(`meas.t.${i.title}`)} <Ltr className="font-medium">{i.detail}</Ltr></>
                        : i.kind === "dose" ? <><Ltr className="font-medium">{i.title}</Ltr> — {t(`meds.st_${i.detail}`)}</>
                        : i.kind === "appointment" ? <>{t(`trd.appt_${i.detail}`, { defaultValue: i.detail ?? "" })}</>
                        : i.kind === "diagnosis" ? <><Ltr className="font-medium">{i.title}</Ltr> <Ltr className="text-muted-foreground">({i.detail})</Ltr></>
                        : <><Ltr className="font-medium">{i.title}</Ltr> <Ltr className="text-muted-foreground">{i.detail}</Ltr></>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </PCard>
      )}
      <p className="text-xs text-muted-foreground">{t("trd.timelineNote")}</p>
    </div>
  );
}
