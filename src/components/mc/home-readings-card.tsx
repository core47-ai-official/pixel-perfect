import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Line, LineChart, ReferenceArea, ResponsiveContainer, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Ltr } from "@/components/mc/ltr";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { dailySeries, lastDays, summarize, type Target, type Targets } from "@/lib/trends";
import type { MType } from "@/lib/measurements";

interface Reading { type: MType; value_1: number; value_2: number | null; unit: string | null; measured_at: string }
interface HomeData {
  shared: boolean; connection_id?: string; shared_at?: string; followup_on?: string | null;
  permissions?: { measurements: boolean; medicines: boolean; symptoms: boolean };
  measurements?: Reading[] | null; targets?: Targets;
  adherence?: { overall: number | null; medicines: { name: string; dose: string | null; taken: number; total: number; pct: number | null }[] } | null;
  symptoms?: { symptom: string; severity: number; started_at: string }[] | null;
}
const TYPES: MType[] = ["bp", "glucose", "weight", "pulse"];
const pkDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric" });

/** Consultation left panel: the patient's shared tracker data (14 days). Shows only what the patient allows; nothing otherwise. */
export function HomeReadingsCard({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["home-readings", patientId],
    queryFn: () => callEdgeFunction<HomeData>("get-home-readings", { patient_id: patientId }),
    refetchOnWindowFocus: true,
  });
  const days = lastDays(14);
  return (
    <section className="rounded-lg border bg-card p-4 text-sm" data-testid="home-readings">
      <h2 className="mb-1 font-semibold">{t("home.title")}</h2>
      {q.isLoading ? <Skeleton className="h-24" /> : !q.data?.shared ? (
        <p className="text-muted-foreground">{t("home.empty")}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("home.sharedOn", { date: pkDate(q.data.shared_at!) })}</p>
          {q.data.permissions?.measurements && TYPES.map((ty) => {
            const rows = (q.data!.measurements ?? []).filter((m) => m.type === ty);
            const target = q.data!.targets?.[ty];
            const pts = dailySeries(rows, days, target);
            const sum = summarize(pts);
            return (
              <div key={ty} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{t(`meas.t.${ty}`)}</span>
                  <Ltr className="text-xs text-muted-foreground">
                    {sum.logged ? `${t("home.avg")} ${sum.avg1}${ty === "bp" && sum.avg2 != null ? `/${sum.avg2}` : ""} · ${sum.logged}/14` : t("home.none")}
                  </Ltr>
                </div>
                {sum.logged > 0 && (
                  <div className="h-12" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={pts} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                        <YAxis hide domain={["auto", "auto"]} />
                        {target?.low != null && target?.high != null && <ReferenceArea y1={target.low} y2={target.high} fill="var(--color-primary)" fillOpacity={0.1} />}
                        <Line dataKey="v1" stroke="var(--color-primary)" dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
                        {ty === "bp" && <Line dataKey="v2" stroke="var(--color-muted-foreground)" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <TargetEditor patientId={patientId} type={ty} target={target} />
              </div>
            );
          })}
          {q.data.adherence && (
            <div>
              <p className="font-medium">{t("home.adherence")}: <Ltr>{q.data.adherence.overall == null ? "—" : `${q.data.adherence.overall}%`}</Ltr></p>
              <ul className="text-xs text-muted-foreground">{q.data.adherence.medicines.map((m) => (
                <li key={m.name} className="flex justify-between"><Ltr>{m.name} {m.dose ?? ""}</Ltr><Ltr>{m.pct == null ? "—" : `${m.pct}%`} ({m.taken}/{m.total})</Ltr></li>
              ))}</ul>
            </div>
          )}
          {q.data.symptoms && (
            <div>
              <p className="font-medium">{t("home.symptoms")}</p>
              {q.data.symptoms.length ? <ul className="text-xs">{q.data.symptoms.map((s, i) => (
                <li key={i} className="flex justify-between"><span>{s.symptom}</span><Ltr className="text-muted-foreground">{s.severity}/10 · {pkDate(s.started_at)}</Ltr></li>
              ))}</ul> : <p className="text-xs text-muted-foreground">{t("home.none")}</p>}
            </div>
          )}
          <FollowUp patientId={patientId} value={q.data.followup_on ?? null} />
        </div>
      )}
    </section>
  );
}

function TargetEditor({ patientId, type, target }: { patientId: string; type: MType; target?: Target }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ low: target?.low ?? "", high: target?.high ?? "", low_2: target?.low_2 ?? "", high_2: target?.high_2 ?? "" });
  const save = async () => {
    try {
      await callEdgeFunction("set-target-range", { patient_id: patientId, type, ...v });
      toast.success(t("home.targetSaved")); setOpen(false);
      await qc.invalidateQueries({ queryKey: ["home-readings", patientId] });
    } catch (e) { toast.error((e as Error).message); }
  };
  const label = target && (target.low != null || target.high != null)
    ? `${target.low ?? "…"}–${target.high ?? "…"}${type === "bp" ? ` / ${target.low_2 ?? "…"}–${target.high_2 ?? "…"}` : ""}` : null;
  if (!open) return (
    <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => setOpen(true)}>
      {label ? <>{t("home.target")}: <Ltr>{label}</Ltr></> : t("home.setTarget")}
    </button>
  );
  const f = (k: keyof typeof v, ph: string) => (
    <Input className="h-8 w-16 px-2" dir="ltr" inputMode="decimal" placeholder={ph} aria-label={ph} value={String(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
  );
  return (
    <div className="flex flex-wrap items-center gap-1">
      {f("low", t("home.low"))}{f("high", t("home.high"))}
      {type === "bp" && <>{f("low_2", t("home.lowDia"))}{f("high_2", t("home.highDia"))}</>}
      <Button size="sm" className="h-8" onClick={save}>{t("common.save", { defaultValue: "Save" })}</Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)}>{t("common.cancel", { defaultValue: "Cancel" })}</Button>
    </div>
  );
}

function FollowUp({ patientId, value }: { patientId: string; value: string | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [d, setD] = useState(value ?? "");
  const save = async (next: string | null) => {
    try {
      await callEdgeFunction("set-target-range", { patient_id: patientId, followup_on: next });
      toast.success(t("home.followupSaved"));
      await qc.invalidateQueries({ queryKey: ["home-readings", patientId] });
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="space-y-1 border-t pt-2">
      <label className="text-xs font-medium" htmlFor={`fu-${patientId}`}>{t("home.followup")}</label>
      <div className="flex gap-1">
        <Input id={`fu-${patientId}`} type="date" dir="ltr" className="h-8" value={d} onChange={(e) => setD(e.target.value)} />
        <Button size="sm" className="h-8" disabled={!d || d === value} onClick={() => save(d)}>{t("common.save", { defaultValue: "Save" })}</Button>
        {value && <Button size="sm" variant="ghost" className="h-8" onClick={() => { setD(""); save(null); }}>{t("home.clear")}</Button>}
      </div>
    </div>
  );
}
