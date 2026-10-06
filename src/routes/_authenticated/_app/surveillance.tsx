import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { SURV_CODES, SURV_GROUPS, type SurvGroup, type SurvReport } from "@/lib/surveillance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/surveillance")({
  head: () => ({ meta: [
    { title: "Disease surveillance — MediCore HMS" },
    { name: "description", content: "Dengue, malaria, typhoid, hepatitis, TB, measles and heatstroke cases by day, district and age, with surge alerts." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("surveillance")}>
      <SurveillancePage />
    </RequireRole>
  ),
});

const pkDate = (off = 0) => new Date(Date.now() + 5 * 3600e3 + off * 864e5).toISOString().slice(0, 10);
const short = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function SurveillancePage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(pkDate(-55));
  const [to, setTo] = useState(pkDate());
  const q = useQuery({ queryKey: ["surveillance", from, to], retry: false, refetchInterval: 60_000,
    queryFn: () => callEdgeFunction<SurvReport>("get-surveillance-report", { from, to }) });
  const r = q.data;

  const exportXlsx = async () => {
    if (!r) return;
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const bold = (ws: import("exceljs").Worksheet) => { ws.getRow(1).font = { bold: true }; };
      const gName = (g: string) => t(`surv.g.${g}`);
      const daily = wb.addWorksheet(t("surv.dayCol"));
      daily.columns = [{ header: t("surv.dayCol"), key: "day", width: 12 }, ...SURV_GROUPS.map((g) => ({ header: gName(g), key: g, width: 13 }))];
      r.daily.forEach((d) => daily.addRow(d));
      const n = r.daily.length + 1;
      daily.addRow({ day: t("surv.total"), ...Object.fromEntries(SURV_GROUPS.map((g, i) => { const col = String.fromCharCode(66 + i); return [g, { formula: `SUM(${col}2:${col}${n})` }]; })) }).font = { bold: true };
      bold(daily);
      for (const [title, rows, key] of [[t("surv.districts"), r.districts, "district"], [t("surv.ages"), r.ages, "age"]] as const) {
        const ws = wb.addWorksheet(title);
        ws.columns = [{ header: t(`surv.${key}`), key, width: 20 }, ...SURV_GROUPS.map((g) => ({ header: gName(g), key: g, width: 13 })), { header: t("surv.total"), key: "total", width: 10 }];
        (rows as Record<string, unknown>[]).forEach((x, i) => ws.addRow({ ...Object.fromEntries(SURV_GROUPS.map((g) => [g, 0])), ...x, total: { formula: `SUM(B${i + 2}:H${i + 2})` } }));
        bold(ws);
      }
      const wk = wb.addWorksheet(t("surv.weekly"));
      wk.columns = [{ header: "Disease", key: "g", width: 16 }, { header: t("surv.weekEnd"), key: "end", width: 14 }, { header: t("surv.cases"), key: "count", width: 10 }, { header: t("surv.baseline"), key: "baseline", width: 12 }, { header: t("surv.surge"), key: "surge", width: 10 }];
      SURV_GROUPS.forEach((g) => (r.weeks[g] ?? []).forEach((w) => {
        const row = wk.addRow({ g: gName(g), end: w.end, count: w.count, baseline: w.baseline, surge: w.surge ? "YES" : "" });
        if (w.surge) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E2" } };
      }));
      bold(wk);
      wb.eachSheet((ws) => ws.eachRow((row) => { row.font = { ...row.font, name: "Arial" }; }));
      const buf = await wb.xlsx.writeBuffer();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      a.download = `surveillance-${from}-to-${to}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">{t("surv.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("surv.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label htmlFor="sv-from">{t("surv.from")}</Label><Input id="sv-from" type="date" dir="ltr" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="sv-to">{t("surv.to")}</Label><Input id="sv-to" type="date" dir="ltr" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
          <Button variant="outline" onClick={exportXlsx} disabled={!r}><FileSpreadsheet className="size-4" />{t("surv.export")}</Button>
        </div>
      </header>

      {q.error && <Banner tone="warning" title={t("surv.title")}>{(q.error as { message?: string }).message}</Banner>}
      {q.isLoading && <Skeleton className="h-64" />}
      {r && r.surges.length > 0 && (
        <Banner tone="danger" title={t("surv.surgeCount", { count: new Set(r.surges.map((s) => s.group)).size })}>
          <ul className="list-disc ps-5">{r.surges.map((s) => <li key={s.group + s.week_end}>{t(`surv.g.${s.group}`)} — {t("surv.surgeOn", { week: short(s.week_end), count: s.count, baseline: s.baseline, pct: s.pct })}</li>)}</ul>
        </Banner>
      )}

      {r && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {SURV_GROUPS.map((g) => <DiseaseChart key={g} group={g} r={r} />)}
        </div>
      )}

      {r && <CountTable title={t("surv.districts")} keyName="district" rows={r.districts} />}
      {r && <CountTable title={t("surv.ages")} keyName="age" rows={r.ages} />}
    </div>
  );
}

function DiseaseChart({ group, r }: { group: SurvGroup; r: SurvReport }) {
  const { t } = useTranslation();
  const weeks = r.weeks[group] ?? [];
  const surge = weeks.some((w) => w.surge);
  const last = weeks.at(-1);
  const config: ChartConfig = { [group]: { label: t(`surv.g.${group}`), color: surge ? "var(--urgent)" : "var(--primary)" } };
  return (
    <section className={cn("rounded-staff border bg-card p-4", surge && "border-urgent ring-1 ring-urgent")}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 font-semibold">{surge && <AlertTriangle className="size-4 text-urgent" aria-hidden />}{t(`surv.g.${group}`)}</h2>
          <p className="text-xs text-muted-foreground">{t("surv.codes")} <Ltr>{SURV_CODES[group]}</Ltr></p>
        </div>
        <div className="text-end">
          <p className="text-2xl font-semibold tnum"><Ltr>{r.totals[group] ?? 0}</Ltr></p>
          <p className="text-xs text-muted-foreground">{t("surv.cases")}</p>
        </div>
      </div>
      <ChartContainer config={config} className="h-36 w-full">
        <LineChart data={r.daily} margin={{ left: -24, right: 4, top: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickFormatter={short} tickLine={false} axisLine={false} minTickGap={24} fontSize={10} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={10} />
          <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => short(String(v))} />} />
          <Line type="monotone" dataKey={group} stroke={`var(--color-${group})`} strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
      <div className="mt-2 flex flex-wrap gap-1">
        {weeks.slice(-8).map((w) => (
          <span key={w.end} title={`${t("surv.weekEnd")} ${w.end} · ${t("surv.baseline")} ${w.baseline}`}
            className={cn("rounded px-1.5 py-0.5 text-[11px] tnum", w.surge ? "bg-urgent-soft font-semibold text-urgent-fg" : "bg-muted text-muted-foreground")}>
            <Ltr>{short(w.end)}: {w.count}</Ltr>
          </span>
        ))}
      </div>
      {last && <p className="mt-1 text-xs text-muted-foreground">{t("surv.weekly")}: <Ltr>{last.count}</Ltr> · {t("surv.baseline")}: <Ltr>{last.baseline}</Ltr></p>}
    </section>
  );
}

function CountTable({ title, keyName, rows }: { title: string; keyName: "district" | "age"; rows: Record<string, unknown>[] }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("surv.none")}</p> : (
        <div className="overflow-x-auto rounded-staff border bg-card">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-xs text-muted-foreground">
              <th className="px-3 py-2 text-start font-medium">{t(`surv.${keyName}`)}</th>
              {SURV_GROUPS.map((g) => <th key={g} className="px-3 py-2 text-end font-medium">{t(`surv.g.${g}`)}</th>)}
              <th className="px-3 py-2 text-end font-medium">{t("surv.total")}</th>
            </tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row[keyName])} className="border-b last:border-0">
                  <td className="px-3 py-2">{keyName === "age" ? <Ltr>{String(row["age"])}</Ltr> : String(row["district"])}</td>
                  {SURV_GROUPS.map((g) => <td key={g} className="px-3 py-2 text-end tnum"><Ltr>{Number(row[g] ?? 0) || "–"}</Ltr></td>)}
                  <td className="px-3 py-2 text-end font-semibold tnum"><Ltr>{String(row["total"])}</Ltr></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
