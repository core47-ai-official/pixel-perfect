import type { TFunction } from "i18next";
import { CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from "recharts";
import { Ltr } from "@/components/mc/ltr";
import { pkDay } from "@/lib/portal";
import { QUICK_TYPES } from "@/lib/measurements";
import { dailySeries, daysBetween, minMax, summarize, type HealthReport } from "@/lib/trends";

const UNIT: Record<string, string> = { bp: "mmHg", glucose: "mg/dL", weight: "kg", temp: "°C", pulse: "bpm", spo2: "%" };
const band = (lo?: number | null, hi?: number | null) => ({ ...(lo != null ? { y1: lo } : {}), ...(hi != null ? { y2: hi } : {}) });

/** Body of the A4 health report; pt = print translator (English first, then the patient's print language). */
export function HealthReportBody({ r, pt }: { r: HealthReport; pt: TFunction }) {
  const days = daysBetween(r.from, r.to);
  const sym = new Map<string, { n: number; sev: number; last: string }>();
  for (const s of r.symptoms) { const e = sym.get(s.symptom) ?? { n: 0, sev: 0, last: s.started_at }; e.n++; e.sev += s.severity; e.last = s.started_at; sym.set(s.symptom, e); }
  return (
    <div className="space-y-3 text-[11px]">
      <p className="text-center text-base font-bold">{pt("hr.title")}</p>
      <div className="grid grid-cols-2 gap-x-3">
        <span>{pt("print.slip.name")}: {r.patient?.full_name ?? "—"}</span>
        <span className="text-end">{pt("hr.period")}: <Ltr>{r.from} – {r.to}</Ltr></span>
        {r.patient?.mrn && <span>MRN: <Ltr>{r.patient.mrn}</Ltr></span>}
        <span className={r.patient?.mrn ? "text-end" : ""}>{pt("hr.generated")}: <Ltr>{pkDay(r.generated_at)}</Ltr></span>
        {r.profile && <span className="col-span-2">{pt("trk.height")}: <Ltr>{r.profile.height_cm ?? "—"} cm</Ltr> · {pt("trk.weight")}: <Ltr>{r.profile.weight_kg ?? "—"} kg</Ltr> · {pt("trk.bloodGroup")}: <Ltr>{r.profile.blood_group ?? "—"}</Ltr></span>}
      </div>

      <section><p className="mc-rule border-b font-semibold">{pt("trk.conditions")}</p>
        <p>{r.conditions.length ? r.conditions.map((c) => c.name).join(", ") : pt("trk.noConditions")}</p></section>

      <section><p className="mc-rule border-b font-semibold">{pt("hr.medicines")}</p>
        {r.medicines.length ? (
          <table className="w-full"><thead><tr className="text-start"><th className="text-start">{pt("meds.name")}</th><th className="text-start">{pt("meds.times")}</th><th>{pt("meds.st_taken")}</th><th>{pt("meds.st_skipped")}</th><th>{pt("meds.st_missed")}</th><th>{pt("meds.adherence")}</th></tr></thead>
            <tbody>{r.medicines.map((m) => { const d = m.taken + m.skipped + m.missed; return (
              <tr key={m.name}><td><Ltr>{m.name}{m.dose ? ` · ${m.dose}` : ""}</Ltr>{m.source === "hospital" ? " *" : ""}</td><td><Ltr>{m.times.join(", ") || "—"}</Ltr></td>
                <td className="text-center"><Ltr>{m.taken}</Ltr></td><td className="text-center"><Ltr>{m.skipped}</Ltr></td><td className="text-center"><Ltr>{m.missed}</Ltr></td>
                <td className="text-center"><Ltr>{d ? `${Math.round((m.taken / d) * 100)}%` : "—"}</Ltr></td></tr>); })}</tbody></table>
        ) : <p>{pt("trk.noMedicines")}</p>}
        {r.medicines.some((m) => m.source === "hospital") && <p className="text-[10px]">* {pt("meds.fromHospital")}</p>}
      </section>

      <section className="space-y-2"><p className="mc-rule border-b font-semibold">{pt("hr.readings")}</p>
        {QUICK_TYPES.map((type) => {
          const rows = r.readings.filter((x) => x.type === type);
          if (!rows.length) return null;
          const tg = r.targets[type];
          const pts = dailySeries(rows, days, tg);
          const s = summarize(pts);
          const mm = minMax(rows)!;
          const bp = type === "bp";
          const fmt = (a: number | null, b: number | null) => (bp ? `${a ?? "—"}/${b ?? "—"}` : `${a ?? "—"}`);
          const sentence = s.hasTarget ? pt("trd.sumRange", { measure: pt(`meas.t.${type}`), n: s.inRange, logged: s.logged })
            : pt("trd.sumAvg", { measure: pt(`meas.t.${type}`), n: s.logged, days: s.days, avg: fmt(s.avg1, s.avg2), unit: UNIT[type] });
          return (
            <div key={type} className="break-inside-avoid">
              <p className="font-medium">{pt(`meas.t.${type}`)} <Ltr className="font-normal">({UNIT[type]})</Ltr></p>
              <table className="w-full"><thead><tr><th>{pt("hr.readingsN")}</th><th>{pt("hr.daysLogged")}</th><th>{pt("hr.min")}</th><th>{pt("hr.avg")}</th><th>{pt("hr.max")}</th></tr></thead>
                <tbody><tr className="text-center"><td><Ltr>{mm.count}</Ltr></td><td><Ltr>{s.logged}/{s.days}</Ltr></td><td><Ltr>{fmt(mm.min1, mm.min2)}</Ltr></td><td><Ltr>{fmt(s.avg1, s.avg2)}</Ltr></td><td><Ltr>{fmt(mm.max1, mm.max2)}</Ltr></td></tr></tbody></table>
              <p>{sentence}</p>
              <div dir="ltr">
                <LineChart width={640} height={130} data={pts} margin={{ left: -12, right: 8, top: 6 }}>
                  <CartesianGrid vertical={false} stroke="#ddd" />
                  <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)} tick={{ fontSize: 9 }} minTickGap={14} />
                  <YAxis tick={{ fontSize: 9 }} domain={["auto", "auto"]} width={40} />
                  {tg && (tg.low != null || tg.high != null) && <ReferenceArea {...band(tg.low, tg.high)} fill="#888" fillOpacity={0.15} strokeOpacity={0} ifOverflow="extendDomain" />}
                  <Line dataKey="v1" stroke="#111" strokeWidth={1.5} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
                  {bp && <Line dataKey="v2" stroke="#777" strokeWidth={1.5} dot={{ r: 2 }} connectNulls isAnimationActive={false} />}
                </LineChart>
              </div>
            </div>
          );
        })}
        {!r.readings.length && <p>{pt("trd.sumNone", { days: days.length })}</p>}
      </section>

      <section className="break-inside-avoid"><p className="mc-rule border-b font-semibold">{pt("hr.symptoms")}</p>
        {sym.size ? (
          <table className="w-full"><thead><tr><th className="text-start">{pt("hr.symptom")}</th><th>{pt("hr.times")}</th><th>{pt("hr.avgSeverity")}</th><th>{pt("hr.last")}</th></tr></thead>
            <tbody>{[...sym.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => (
              <tr key={k}><td><Ltr>{k}</Ltr></td><td className="text-center"><Ltr>{v.n}</Ltr></td><td className="text-center"><Ltr>{(v.sev / v.n).toFixed(1)}/10</Ltr></td><td className="text-center"><Ltr>{pkDay(v.last)}</Ltr></td></tr>
            ))}</tbody></table>
        ) : <p>{pt("hr.noSymptoms")}</p>}
      </section>

      <p className="mc-rule border-t pt-1 text-[10px]">{pt("hr.disclaimer")}</p>
    </div>
  );
}
