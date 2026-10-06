import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Measurement } from "@/lib/measurements";
import type { MType } from "@/lib/measurements";

/** Doctor-set target per measure (tracker_profiles.targets). For BP, low/high = systolic, low_2/high_2 = diastolic. */
export interface Target { low?: number | null; high?: number | null; low_2?: number | null; high_2?: number | null }
export type Targets = Partial<Record<MType, Target>>;

const PK = 5 * 3600e3;
/** Pakistan calendar day "YYYY-MM-DD" of an instant. */
export const pkYmd = (ms: number) => new Date(ms + PK).toISOString().slice(0, 10);
/** The last `n` Pakistan days, oldest first, ending today. */
export const lastDays = (n: number, nowMs = Date.now()) => Array.from({ length: n }, (_, i) => pkYmd(nowMs - (n - 1 - i) * 86400e3));

export interface DayPoint { day: string; v1: number | null; v2: number | null; count: number; inRange: boolean | null }

const inT = (v: number, lo?: number | null, hi?: number | null) => (lo == null || v >= lo) && (hi == null || v <= hi);
const hasT = (t?: Target) => !!t && [t.low, t.high, t.low_2, t.high_2].some((x) => x != null);

/** One point per day: the day's average; a day is in range only if every reading that day was. */
export function dailySeries(rows: Pick<Measurement, "value_1" | "value_2" | "measured_at">[], days: string[], target?: Target): DayPoint[] {
  const by = new Map<string, typeof rows>();
  for (const r of rows) { const d = pkYmd(Date.parse(r.measured_at)); by.set(d, [...(by.get(d) ?? []), r]); }
  return days.map((day) => {
    const list = by.get(day) ?? [];
    if (!list.length) return { day, v1: null, v2: null, count: 0, inRange: null };
    const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
    const v2s = list.map((r) => r.value_2).filter((x): x is number => x != null).map(Number);
    const inRange = hasT(target)
      ? list.every((r) => inT(Number(r.value_1), target!.low, target!.high) && (r.value_2 == null || inT(Number(r.value_2), target!.low_2, target!.high_2)))
      : null;
    return { day, v1: avg(list.map((r) => Number(r.value_1))), v2: v2s.length ? avg(v2s) : null, count: list.length, inRange };
  });
}

/** Plain one-sentence summary inputs (no diagnosis wording). */
export function summarize(points: DayPoint[]) {
  const logged = points.filter((p) => p.count > 0);
  const inRange = logged.filter((p) => p.inRange === true).length;
  const hasTarget = logged.some((p) => p.inRange !== null);
  const avg = (k: "v1" | "v2") => { const xs = logged.map((p) => p[k]).filter((x): x is number => x != null); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null; };
  return { days: points.length, logged: logged.length, inRange, hasTarget, avg1: avg("v1"), avg2: avg("v2") };
}

export const useTrendData = (days: number) => useQuery({
  queryKey: ["trends", days],
  queryFn: async () => {
    const since = new Date(Date.parse(`${lastDays(days)[0]}T00:00:00Z`) - PK).toISOString();
    const [m, p] = await Promise.all([
      supabase.from("measurements").select("type, value_1, value_2, measured_at").gte("measured_at", since).order("measured_at"),
      supabase.from("tracker_profiles").select("targets").maybeSingle(),
    ]);
    if (m.error) throw m.error;
    return { rows: (m.data ?? []) as Pick<Measurement, "type" | "value_1" | "value_2" | "measured_at">[], targets: ((p.data?.targets ?? {}) as Targets) };
  },
});

export type TimelineKind = "reading" | "symptom" | "dose" | "appointment" | "diagnosis";
export interface TimelineItem { id: string; kind: TimelineKind; at: string; title: string; detail?: string | null }

/** Last 90 days of the patient's own records (RLS limits every table to own rows). */
export const useTimeline = () => useQuery({
  queryKey: ["tracker-timeline"],
  queryFn: async (): Promise<TimelineItem[]> => {
    const since = new Date(Date.now() - 90 * 86400e3).toISOString();
    const [m, s, d, a, dx] = await Promise.all([
      supabase.from("measurements").select("id, type, value_1, value_2, unit, original_value, original_unit, measured_at").gte("measured_at", since),
      supabase.from("symptom_logs").select("id, symptom, severity, started_at").gte("started_at", since),
      supabase.from("dose_events").select("id, due_at, status, logged_at, medication_schedules(name, dose)").not("status", "is", null).gte("due_at", since),
      supabase.from("appointments").select("id, slot_start, status, token_no").gte("slot_start", since),
      supabase.from("visit_diagnoses").select("id, icd10_code, description, created_at").gte("created_at", since),
    ]);
    const out: TimelineItem[] = [];
    for (const r of m.data ?? []) out.push({ id: `m${r.id}`, kind: "reading", at: r.measured_at, title: r.type,
      detail: r.type === "bp" ? `${Number(r.value_1)}/${Number(r.value_2)} mmHg` : r.original_unit ? `${Number(r.original_value)} ${r.original_unit}` : `${Number(r.value_1)} ${r.unit ?? ""}` });
    for (const r of s.data ?? []) out.push({ id: `s${r.id}`, kind: "symptom", at: r.started_at, title: r.symptom, detail: `${r.severity}/10` });
    for (const r of d.data ?? []) {
      const ms = r.medication_schedules as { name?: string; dose?: string | null } | null;
      out.push({ id: `d${r.id}`, kind: "dose", at: r.due_at, title: ms?.name ?? "", detail: r.status });
    }
    for (const r of a.data ?? []) out.push({ id: `a${r.id}`, kind: "appointment", at: r.slot_start, title: "", detail: r.status });
    for (const r of dx.data ?? []) out.push({ id: `x${r.id}`, kind: "diagnosis", at: r.created_at, title: r.description, detail: r.icd10_code });
    return out.sort((x, y) => (x.at < y.at ? 1 : -1));
  },
});

/** Every Pakistan day from `from` to `to` inclusive ("YYYY-MM-DD"). */
export const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`) && out.length < 400; ms += 86400e3) out.push(new Date(ms).toISOString().slice(0, 10));
  return out;
};

/** Lowest / highest single reading (value_1, and value_2 for BP). */
export function minMax(rows: Pick<Measurement, "value_1" | "value_2">[]) {
  if (!rows.length) return null;
  const v1 = rows.map((r) => Number(r.value_1)), v2 = rows.map((r) => r.value_2).filter((x): x is number => x != null).map(Number);
  return { min1: Math.min(...v1), max1: Math.max(...v1), min2: v2.length ? Math.min(...v2) : null, max2: v2.length ? Math.max(...v2) : null, count: rows.length };
}

export interface HealthReport {
  from: string; to: string; generated_at: string;
  patient: { full_name: string; mrn: string; dob: string | null; gender: string | null; print_language: string | null } | null;
  profile: { height_cm: number | null; weight_kg: number | null; blood_group: string | null; health_status: string | null } | null;
  targets: Targets;
  conditions: { name: string; status: string; onset_date: string | null }[];
  medicines: { name: string; dose: string | null; times: string[]; source: string; active: boolean; taken: number; skipped: number; missed: number }[];
  readings: (Pick<Measurement, "value_1" | "value_2" | "measured_at"> & { type: string })[];
  symptoms: { symptom: string; severity: number; started_at: string }[];
}
