import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Banknote, CalendarX, ClipboardList, FileSpreadsheet, Hourglass, Stethoscope } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/mc/data-table";
import { StatCard } from "@/components/mc/stat-card";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { formatPkr } from "@/lib/patient-summary";
import { useDepartmentsData } from "@/lib/departments-data";

export const Route = createFileRoute("/_authenticated/_app/reports")({
  head: () => ({ meta: [
    { title: "Department reports — MediCore HMS" },
    { name: "description", content: "OPD load, waiting time, diagnoses, prescriptions, revenue and no-shows per doctor, with Excel export." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("reports")}>
      <ReportsPage />
    </RequireRole>
  ),
});

interface DocRow { doctor_id: string; name: string; specialty: string; opd: number; done: number; no_shows: number; avg_wait_min: number | null; prescriptions: number; revenue: number }
interface Report {
  department: { id: string; name: string };
  doctors: DocRow[];
  totals: { opd: number; done: number; no_shows: number; prescriptions: number; avg_wait_min: number | null; revenue: number; unassigned_revenue: number };
  top_diagnoses: { code: string; description: string; count: number }[];
}

const pkToday = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 5 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);

function ReportsPage() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const isAdmin = hasRole("admin", "super_admin");
  const { depts } = useDepartmentsData();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(pkToday());
  const [dept, setDept] = useState<string>("");
  const deptId = isAdmin ? dept || (hasRole("dept_head") ? "mine" : "") : "mine";

  const report = useQuery({
    queryKey: ["dept-report", deptId, from, to], enabled: !!deptId && !!from && !!to, retry: false,
    queryFn: () => callEdgeFunction<Report>("get-department-report", { department_id: deptId, from, to }),
  });
  const r = report.data;

  const columns: Column<DocRow>[] = [
    { key: "name", header: t("dh.col.doctor"), sortable: true, render: (d) => <span className="font-medium">{d.name || "—"}</span> },
    { key: "opd", header: t("dh.col.opd"), sortable: true, numeric: true, render: (d) => <Ltr>{d.opd}</Ltr> },
    { key: "done", header: t("dh.col.done"), sortable: true, numeric: true, render: (d) => <Ltr>{d.done}</Ltr> },
    { key: "avg_wait_min", header: t("dh.col.wait"), sortable: true, numeric: true, render: (d) => <Ltr>{d.avg_wait_min ?? "—"}</Ltr> },
    { key: "prescriptions", header: t("dh.col.rx"), sortable: true, numeric: true, render: (d) => <Ltr>{d.prescriptions}</Ltr> },
    { key: "no_shows", header: t("dh.col.noShows"), sortable: true, numeric: true, render: (d) => <Ltr>{d.no_shows}</Ltr> },
    { key: "revenue", header: t("dh.col.revenue"), sortable: true, numeric: true, render: (d) => <Ltr className="font-semibold">{formatPkr(d.revenue)}</Ltr> },
  ];

  const exportXlsx = async () => {
    if (!r) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("By doctor");
    const keys = ["name", "specialty", "opd", "done", "avg_wait_min", "prescriptions", "no_shows", "revenue"] as const;
    ws.columns = keys.map((k) => ({ header: t(`dh.col.${({ name: "doctor", specialty: "specialty", opd: "opd", done: "done", avg_wait_min: "wait", prescriptions: "rx", no_shows: "noShows", revenue: "revenue" } as const)[k]}`), key: k, width: k === "name" ? 28 : 14 }));
    r.doctors.forEach((d) => ws.addRow({ ...d, avg_wait_min: d.avg_wait_min ?? "" }));
    ws.addRow({ name: t("dh.total"), opd: r.totals.opd, done: r.totals.done, avg_wait_min: r.totals.avg_wait_min ?? "", prescriptions: r.totals.prescriptions, no_shows: r.totals.no_shows, revenue: r.totals.revenue }).font = { bold: true };
    ws.getRow(1).font = { bold: true };
    ws.getColumn("revenue").numFmt = '"Rs" #,##0;("Rs" #,##0);-';
    ws.views = [{ state: "frozen", ySplit: 1 }];
    const dx = wb.addWorksheet("Top diagnoses");
    dx.columns = [{ header: "ICD-10", key: "code", width: 12 }, { header: t("dh.col.diagnosis"), key: "description", width: 50 }, { header: t("dh.col.count"), key: "count", width: 10 }];
    r.top_diagnoses.forEach((d) => dx.addRow(d));
    dx.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `department-report-${r.department.name.replace(/\W+/g, "-").toLowerCase()}-${from}-to-${to}.xlsx`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t("dh.reportsTitle")}{r ? ` · ${r.department.name}` : ""}</h1>
          <p className="text-sm text-muted-foreground">{t("dh.reportsDesc")}</p>
        </div>
        <Button variant="outline" disabled={!r} onClick={() => void exportXlsx()}><FileSpreadsheet /> {t("dh.export")}</Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {isAdmin && (
          <div className="space-y-1"><Label>{t("dh.department")}</Label>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger className="w-56"><SelectValue placeholder={t("dh.chooseDept")} /></SelectTrigger>
              <SelectContent>{(depts.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1"><Label htmlFor="rf">{t("dh.from")}</Label><Input id="rf" type="date" dir="ltr" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div>
        <div className="space-y-1"><Label htmlFor="rt">{t("dh.to")}</Label><Input id="rt" type="date" dir="ltr" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>
      </div>

      {!deptId && <Banner tone="info" title={t("dh.chooseDept")} />}
      {report.error && <Banner tone="danger" title={(report.error as { message?: string }).message ?? t("dh.failed")} />}
      {report.isLoading && deptId && <Skeleton className="h-64 w-full" />}
      {r && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label={t("dh.col.opd")} value={r.totals.opd} icon={Stethoscope} caption={t("dash.w.doneN", { n: r.totals.done })} />
            <StatCard label={t("dh.col.wait")} value={r.totals.avg_wait_min ?? "—"} icon={Hourglass} />
            <StatCard label={t("dh.col.rx")} value={r.totals.prescriptions} icon={ClipboardList} />
            <StatCard label={t("dh.col.noShows")} value={r.totals.no_shows} icon={CalendarX} />
            <StatCard label={t("dh.col.revenue")} value={formatPkr(r.totals.revenue)} icon={Banknote} />
          </div>
          <DataTable rows={r.doctors.map((d) => ({ ...d, id: d.doctor_id }))} columns={columns as Column<DocRow & { id: string }>[]} searchKeys={["name"]} pageSize={20} />
          <div className="rounded-staff border bg-card p-4">
            <h2 className="mb-2 font-semibold">{t("dh.topDiagnoses")}</h2>
            {r.top_diagnoses.length === 0 ? <p className="text-sm text-muted-foreground">{t("dh.noData")}</p> : (
              <ol className="divide-y text-sm">
                {r.top_diagnoses.map((d, i) => (
                  <li key={i} className="flex justify-between gap-2 py-1.5">
                    <span><Ltr className="me-2 text-muted-foreground">{i + 1}.</Ltr><Ltr className="me-2 font-medium">{d.code}</Ltr>{d.description}</span>
                    <Ltr>{d.count}</Ltr>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
}
