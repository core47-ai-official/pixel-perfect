import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, Repeat, Stethoscope, Syringe, UserPlus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Ltr } from "@/components/mc/ltr";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- types */

export type CalendarView = "day" | "byDoctor" | "week" | "month";
export type CalendarMode = "status" | "eventKind" | "otPriority" | "shiftType";
export type CalendarTab = "all" | "waiting" | "completed";
type Tone = "urgent" | "warning" | "caution" | "ok" | "progress" | "inactive";

export interface CalEvent {
  id: string;
  start: Date;
  end: Date;
  title: string;
  subtitle?: string | undefined;
  /** Resource column (e.g. doctor id) for the "By doctor" view. */
  columnId?: string;
  departmentId?: string | null;
  /** Key looked up in the palette of the current colour mode. */
  colorKey: string;
  status: string;
  type?: string;
  token?: number | null;
  draggable?: boolean;
}
export interface TimeRange { start: Date; end: Date; label?: string }
export interface CalColumn {
  id: string;
  label: string;
  sub?: string;
  departmentId?: string | null;
  /** Bookable ranges; anything outside is greyed. Omit to treat the whole day as bookable. */
  available?: TimeRange[];
  /** Hatched blocks, e.g. leave. */
  blocked?: TimeRange[];
}
export interface Option { value: string; label: string }

/** Colour palettes per mode (PRD 10.4.1). Labels come from i18n `cal.legend.<mode>.<key>`. */
export const CALENDAR_PALETTES: Record<CalendarMode, Record<string, Tone>> = {
  status: { booked: "progress", waiting: "caution", in_consultation: "warning", done: "ok", needs_rebooking: "urgent", no_show: "inactive", cancelled: "inactive" },
  eventKind: { appointment: "progress", surgery: "urgent", round: "ok", meeting: "inactive", leave: "warning" },
  otPriority: { emergency: "urgent", urgent: "warning", elective: "ok" },
  shiftType: { morning: "caution", evening: "warning", night: "progress", on_call: "ok", off: "inactive" },
};
export const TONE_CLASS: Record<Tone, string> = {
  urgent: "border-s-urgent bg-urgent-soft text-urgent-fg",
  warning: "border-s-warning bg-warning-soft text-warning-fg",
  caution: "border-s-caution bg-caution-soft text-caution-fg",
  ok: "border-s-ok bg-ok-soft text-ok-fg",
  progress: "border-s-progress bg-progress-soft text-progress-fg",
  inactive: "border-s-inactive bg-inactive-soft text-inactive-fg",
};
const DOT_CLASS: Record<Tone, string> = {
  urgent: "bg-urgent", warning: "bg-warning", caution: "bg-caution", ok: "bg-ok", progress: "bg-progress", inactive: "bg-inactive",
};
export const TYPE_ICONS: Record<string, LucideIcon> = { new: UserPlus, follow_up: Repeat, procedure: Syringe };
const TAB_STATUSES: Record<CalendarTab, string[] | null> = { all: null, waiting: ["booked", "waiting", "in_consultation"], completed: ["done"] };
const ALL = "__all";

export interface CalendarProps {
  events: CalEvent[];
  columns?: CalColumn[];
  date: Date;
  onDateChange: (d: Date) => void;
  view: CalendarView;
  onViewChange: (v: CalendarView) => void;
  mode?: CalendarMode;
  departments?: Option[];
  types?: Option[];
  statuses?: Option[];
  startHour?: number;
  endHour?: number;
  slotMinutes?: number;
  loading?: boolean | undefined;
  onSlotClick?: ((start: Date, columnId: string | null) => void) | undefined;
  onEventClick?: ((e: CalEvent) => void) | undefined;
  onEventDrop?: ((e: CalEvent, newStart: Date, columnId: string | null) => void) | undefined;
  toolbarEnd?: ReactNode | undefined;
}

/* ---------------------------------------------------------------- component */

export function Calendar({
  events, columns = [], date, onDateChange, view, onViewChange, mode = "status",
  departments = [], types = [], statuses = [], startHour = 8, endHour = 20, slotMinutes = 15,
  loading, onSlotClick, onEventClick, onEventDrop, toolbarEnd,
}: CalendarProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<CalendarTab>("all");
  const [dept, setDept] = useState(ALL);
  const [col, setCol] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [status, setStatus] = useState(ALL);

  const visibleColumns = columns.filter((c) => (dept === ALL || c.departmentId === dept) && (col === ALL || c.id === col));
  const colIds = new Set(visibleColumns.map((c) => c.id));
  const filtered = events.filter((e) => {
    const tabStatuses = TAB_STATUSES[tab];
    if (tabStatuses && !tabStatuses.includes(e.status)) return false;
    if (status !== ALL && e.status !== status) return false;
    if (type !== ALL && e.type !== type) return false;
    if (dept !== ALL && e.departmentId !== dept) return false;
    if (col !== ALL && e.columnId !== col) return false;
    if (columns.length && e.columnId && !colIds.has(e.columnId) && view === "byDoctor") return false;
    return true;
  });

  const step = (dir: 1 | -1) => {
    if (view === "month") onDateChange(addMonths(date, dir));
    else if (view === "week") onDateChange(addDays(date, 7 * dir));
    else onDateChange(addDays(date, dir));
  };
  const rangeLabel = view === "month" ? format(date, "MMMM yyyy")
    : view === "week" ? `${format(startOfWeek(date, { weekStartsOn: 1 }), "dd MMM")} – ${format(endOfWeek(date, { weekStartsOn: 1 }), "dd MMM yyyy")}`
    : format(date, "EEE, dd MMM yyyy");

  const palette = CALENDAR_PALETTES[mode];
  const filterSelect = (label: string, value: string, set: (v: string) => void, opts: Option[]) => opts.length > 0 && (
    <Select value={value} onValueChange={set}>
      <SelectTrigger className="h-8 w-auto min-w-32 text-xs" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("common.any", { label: label.toLowerCase() })}</SelectItem>
        {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="size-8" onClick={() => step(-1)} aria-label={t("cal.prev")}><ChevronLeft className="size-4 rtl:rotate-180" /></Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => onDateChange(new Date())}>{t("cal.today")}</Button>
          <Button size="icon" variant="outline" className="size-8" onClick={() => step(1)} aria-label={t("cal.next")}><ChevronRight className="size-4 rtl:rotate-180" /></Button>
        </div>
        <Ltr className="min-w-40 font-semibold">{rangeLabel}</Ltr>
        {!isMobile && (
          <Tabs value={view} onValueChange={(v) => onViewChange(v as CalendarView)} className="ms-auto">
            <TabsList className="h-8">
              {(["day", ...(columns.length ? ["byDoctor"] : []), "week", "month"] as CalendarView[]).map((v) => (
                <TabsTrigger key={v} value={v} className="h-6 px-2.5 text-xs">{t(`cal.views.${v}`)}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        {toolbarEnd}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as CalendarTab)}>
          <TabsList className="h-8">
            {(["all", "waiting", "completed"] as CalendarTab[]).map((x) => (
              <TabsTrigger key={x} value={x} className="h-6 px-2.5 text-xs">{t(`cal.tabs.${x}`)}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {filterSelect(t("cal.filters.department"), dept, setDept, departments)}
        {filterSelect(t("cal.filters.doctor"), col, setCol, columns.map((c) => ({ value: c.id, label: c.label })))}
        {filterSelect(t("cal.filters.type"), type, setType, types)}
        {filterSelect(t("cal.filters.status"), status, setStatus, statuses)}
      </div>

      {/* legend: always visible */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t("cal.legendLabel")}>
        {Object.entries(palette).map(([k, tone]) => (
          <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-full", DOT_CLASS[tone])} />{t(`cal.legend.${mode}.${k}`)}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-muted" />{t("cal.notBookable")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm border bg-hatch" />{t("cal.leave")}</span>
      </div>

      <div className={cn("relative rounded-staff border bg-card", loading && "opacity-60")}>
        {isMobile ? (
          <Agenda events={filtered.filter((e) => isSameDay(e.start, date))} palette={palette} onEventClick={onEventClick} />
        ) : view === "month" ? (
          <MonthGrid date={date} events={filtered} palette={palette} onPickDay={(d) => { onDateChange(d); onViewChange(columns.length ? "byDoctor" : "day"); }} />
        ) : (
          <TimeGrid
            columns={view === "byDoctor" ? visibleColumns.map((c) => ({ ...c, day: startOfDay(date) }))
              : view === "week" ? Array.from({ length: 7 }, (_, i) => {
                const d = addDays(startOfWeek(date, { weekStartsOn: 1 }), i);
                return { id: `day:${format(d, "yyyy-MM-dd")}`, label: format(d, "EEE"), sub: format(d, "dd MMM"), day: d, isDayColumn: true };
              })
              : [{ id: "day:all", label: format(date, "EEEE"), sub: format(date, "dd MMM"), day: startOfDay(date), isDayColumn: true }]}
            events={filtered}
            palette={palette}
            startHour={startHour} endHour={endHour} slotMinutes={slotMinutes}
            onSlotClick={onSlotClick} onEventClick={onEventClick} onEventDrop={onEventDrop}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- time grid */

type GridColumn = CalColumn & { day: Date; isDayColumn?: boolean };
const HOUR_PX = 64;

function TimeGrid({ columns, events, palette, startHour, endHour, slotMinutes, onSlotClick, onEventClick, onEventDrop }: {
  columns: GridColumn[]; events: CalEvent[]; palette: Record<string, Tone>;
  startHour: number; endHour: number; slotMinutes: number;
  onSlotClick?: CalendarProps["onSlotClick"]; onEventClick?: CalendarProps["onEventClick"]; onEventDrop?: CalendarProps["onEventDrop"];
}) {
  const { t } = useTranslation();
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const totalPx = (endHour - startHour) * HOUR_PX;
  const minToPx = (m: number) => (m / 60) * HOUR_PX;
  const offsetMin = (d: Date, day: Date) => (d.getTime() - day.getTime()) / 60000 - startHour * 60;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  useEffect(() => { // scroll near current time on mount
    const el = scroller.current;
    if (el) el.scrollTop = Math.max(0, minToPx(now.getHours() * 60 - startHour * 60 - 60));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const timeAt = (e: React.MouseEvent<HTMLElement> | React.DragEvent<HTMLElement>, day: Date) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mins = ((e.clientY - rect.top) / HOUR_PX) * 60;
    const snapped = Math.max(0, Math.floor(mins / slotMinutes) * slotMinutes);
    return new Date(day.getTime() + (startHour * 60 + snapped) * 60000);
  };
  const eventsFor = (c: GridColumn) => events.filter((e) => isSameDay(e.start, c.day) && (c.isDayColumn || e.columnId === c.id));
  const resourceOf = (c: GridColumn) => (c.isDayColumn ? null : c.id);

  return (
    <div ref={scroller} className="max-h-[70vh] overflow-auto">
      <div className="grid min-w-fit" style={{ gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(9rem, 1fr))` }}>
        {/* header row */}
        <div className="sticky top-0 z-20 border-b bg-card" />
        {columns.map((c) => (
          <div key={c.id} className="sticky top-0 z-20 border-b border-s bg-card px-2 py-2 text-center">
            <div className="truncate text-sm font-medium">{c.label}</div>
            {c.sub && <div className="truncate text-xs text-muted-foreground">{c.sub}</div>}
          </div>
        ))}

        {/* hour labels */}
        <div className="relative" style={{ height: totalPx }}>
          {hours.map((h) => (
            <div key={h} className="absolute end-1 -translate-y-1/2 text-[10px] text-muted-foreground tnum" style={{ top: minToPx((h - startHour) * 60) }}>
              {h > startHour && <Ltr>{`${String(h).padStart(2, "0")}:00`}</Ltr>}
            </div>
          ))}
        </div>

        {columns.map((c) => {
          const evs = layoutLanes(eventsFor(c));
          const isToday = isSameDay(c.day, now);
          const nowMin = offsetMin(now, startOfDay(now));
          return (
            <div
              key={c.id}
              className={cn("relative border-s", c.available ? "bg-muted/60" : "", dragOver === c.id && "ring-2 ring-inset ring-primary/40")}
              style={{ height: totalPx }}
              onClick={(e) => { if (onSlotClick && e.target === e.currentTarget) onSlotClick(timeAt(e, c.day), resourceOf(c)); }}
              onDragOver={(e) => { if (onEventDrop) { e.preventDefault(); setDragOver(c.id); } }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                setDragOver(null);
                const id = e.dataTransfer.getData("text/calendar-event");
                const ev = events.find((x) => x.id === id);
                if (ev && onEventDrop) {
                  const target = e.currentTarget.getBoundingClientRect();
                  const mins = Math.max(0, Math.floor((((e.clientY - target.top) / HOUR_PX) * 60) / slotMinutes) * slotMinutes);
                  onEventDrop(ev, new Date(c.day.getTime() + (startHour * 60 + mins) * 60000), resourceOf(c) ?? ev.columnId ?? null);
                }
              }}
            >
              {/* bookable ranges punch through the grey */}
              {c.available?.map((r, i) => (
                <div key={i} className="pointer-events-none absolute inset-x-0 bg-card"
                  style={{ top: minToPx(offsetMin(r.start, c.day)), height: minToPx((r.end.getTime() - r.start.getTime()) / 60000) }} />
              ))}
              {/* hour lines */}
              {hours.map((h) => (
                <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: minToPx((h - startHour) * 60) }} />
              ))}
              {/* leave */}
              {c.blocked?.map((r, i) => {
                const top = Math.max(0, minToPx(offsetMin(r.start, c.day)));
                const bottom = Math.min(totalPx, minToPx(offsetMin(r.end, c.day)));
                return (
                  <div key={i} className="pointer-events-none absolute inset-x-0 z-[1] flex items-start justify-center bg-hatch pt-2 text-xs font-medium text-warning-fg"
                    style={{ top, height: Math.max(0, bottom - top) }}>{r.label ?? t("cal.leave")}</div>
                );
              })}
              {/* events */}
              {evs.map(({ e, lane, lanes }) => {
                const top = minToPx(offsetMin(e.start, c.day));
                const h = Math.max(22, minToPx((e.end.getTime() - e.start.getTime()) / 60000) - 2);
                const Icon = e.type ? TYPE_ICONS[e.type] ?? Stethoscope : null;
                const tone = palette[e.colorKey] ?? "inactive";
                return (
                  <button
                    key={e.id} type="button"
                    draggable={!!onEventDrop && e.draggable !== false}
                    onDragStart={(d) => { d.dataTransfer.setData("text/calendar-event", e.id); d.dataTransfer.effectAllowed = "move"; }}
                    onClick={() => onEventClick?.(e)}
                    className={cn("absolute z-[2] overflow-hidden rounded-md border-s-4 px-1.5 py-0.5 text-start text-xs shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
                      TONE_CLASS[tone], e.draggable !== false && onEventDrop && "cursor-grab active:cursor-grabbing")}
                    style={{ top, height: h, insetInlineStart: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                  >
                    <div className="flex items-center gap-1 font-semibold">
                      {e.token != null && <Ltr className="rounded bg-background/60 px-1 tnum">{e.token}</Ltr>}
                      <span className="truncate">{e.title}</span>
                    </div>
                    {h > 34 && (
                      <div className="flex items-center gap-1 truncate opacity-80">
                        <Ltr className="tnum">{format(e.start, "HH:mm")}</Ltr>
                        {Icon && e.type && <><Icon className="size-3 shrink-0" />{t(`appt.types.${e.type}`)}</>}
                      </div>
                    )}
                    {h > 50 && e.subtitle && <div className="truncate opacity-70">{e.subtitle}</div>}
                  </button>
                );
              })}
              {/* current time */}
              {isToday && nowMin >= 0 && nowMin <= (endHour - startHour) * 60 && (
                <div className="pointer-events-none absolute inset-x-0 z-[3] h-0.5 bg-urgent" style={{ top: minToPx(nowMin) }}>
                  <span className="absolute -start-1 -top-1 size-2.5 rounded-full bg-urgent" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Side-by-side lanes for overlapping events. */
function layoutLanes(evs: CalEvent[]) {
  const sorted = [...evs].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: { e: CalEvent; lane: number; lanes: number }[] = [];
  let cluster: { e: CalEvent; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = 0;
  const flush = () => { const n = Math.max(1, laneEnds.length); cluster.forEach((c) => out.push({ ...c, lanes: n })); cluster = []; laneEnds = []; };
  for (const e of sorted) {
    if (e.start.getTime() >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= e.start.getTime());
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = e.end.getTime();
    clusterEnd = Math.max(clusterEnd, e.end.getTime());
    cluster.push({ e, lane });
  }
  flush();
  return out;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const h = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(h); }, []);
  return now;
}

/* ---------------------------------------------------------------- month + agenda */

function MonthGrid({ date, events, palette, onPickDay }: { date: Date; events: CalEvent[]; palette: Record<string, Tone>; onPickDay: (d: Date) => void }) {
  const { t } = useTranslation();
  const start = startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(date), { weekStartsOn: 1 });
  const days = useMemo(() => { const a: Date[] = []; for (let d = start; d <= end; d = addDays(d, 1)) a.push(d); return a; }, [start.getTime(), end.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = new Date();
  return (
    <div className="grid grid-cols-7">
      {days.slice(0, 7).map((d) => <div key={d.toISOString()} className="border-b px-2 py-1.5 text-xs font-medium text-muted-foreground">{format(d, "EEE")}</div>)}
      {days.map((d) => {
        const evs = events.filter((e) => isSameDay(e.start, d));
        const counts = evs.reduce<Record<string, number>>((m, e) => ({ ...m, [e.colorKey]: (m[e.colorKey] ?? 0) + 1 }), {});
        return (
          <button key={d.toISOString()} type="button" onClick={() => onPickDay(d)}
            className={cn("min-h-24 border-b border-s p-1.5 text-start align-top hover:bg-accent/50", !isSameMonth(d, date) && "bg-muted/40 text-muted-foreground")}>
            <span className={cn("inline-grid size-6 place-items-center rounded-full text-xs tnum", isSameDay(d, today) && "bg-primary text-primary-foreground")}>{format(d, "d")}</span>
            {evs.length > 0 && <div className="mt-1 text-xs font-medium">{t("cal.count", { count: evs.length })}</div>}
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(counts).map(([k, n]) => (
                <span key={k} className="inline-flex items-center gap-0.5 text-[10px]"><span className={cn("size-2 rounded-full", DOT_CLASS[palette[k] ?? "inactive"])} /><Ltr>{n}</Ltr></span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Agenda({ events, palette, onEventClick }: { events: CalEvent[]; palette: Record<string, Tone>; onEventClick?: CalendarProps["onEventClick"] }) {
  const { t } = useTranslation();
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  if (!sorted.length) return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("cal.empty")}</p>;
  return (
    <ul className="divide-y">
      {sorted.map((e) => {
        const Icon = e.type ? TYPE_ICONS[e.type] ?? Stethoscope : null;
        return (
          <li key={e.id}>
            <button type="button" onClick={() => onEventClick?.(e)} className="flex w-full items-stretch gap-3 px-3 py-2.5 text-start">
              <Ltr className="w-12 shrink-0 pt-0.5 text-sm font-medium tnum">{format(e.start, "HH:mm")}</Ltr>
              <div className={cn("flex-1 rounded-md border-s-4 px-2 py-1.5 text-sm", TONE_CLASS[palette[e.colorKey] ?? "inactive"])}>
                <div className="flex items-center gap-1.5 font-semibold">
                  {e.token != null && <Ltr className="rounded bg-background/60 px-1 text-xs">{e.token}</Ltr>}{e.title}
                </div>
                <div className="flex items-center gap-1 text-xs opacity-80">
                  {Icon && e.type && <><Icon className="size-3" />{t(`appt.types.${e.type}`)} · </>}{e.subtitle}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
