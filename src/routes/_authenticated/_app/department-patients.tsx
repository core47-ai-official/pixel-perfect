import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type Column } from "@/components/mc/data-table";
import { StatusChip } from "@/components/mc/status-chip";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { ageFrom } from "@/lib/patients";

export const Route = createFileRoute("/_authenticated/_app/department-patients")({
  head: () => ({ meta: [
    { title: "Department patients — MediCore HMS" },
    { name: "description", content: "Search patients seen or admitted in your department." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("deptPatients")}>
      <DeptPatients />
    </RequireRole>
  ),
});

interface Row { id: string; mrn: string; full_name: string; dob: string | null; gender: string | null; phone: string | null; last_seen: string; last_doctor: string; own: boolean }
const fmtD = (s: string) => { const d = new Date(s); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };

function DeptPatients() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(h); }, [q]);
  const list = useQuery({
    queryKey: ["dept-patients", debounced], retry: false,
    queryFn: () => callEdgeFunction<{ department: { name: string }; total: number; rows: Row[] }>("get-department-patients", { q: debounced }),
  });
  const columns: Column<Row>[] = [
    { key: "full_name", header: t("dh.col.patient"), sortable: true, render: (r) => (
      <Link to="/patients/$patientId" params={{ patientId: r.id }} className="font-medium hover:underline">{r.full_name}</Link>) },
    { key: "mrn", header: "MRN", render: (r) => <Ltr>{r.mrn}</Ltr> },
    { key: "dob", header: t("dh.col.age"), render: (r) => <Ltr>{ageFrom(r.dob) ?? "—"}</Ltr> },
    { key: "phone", header: t("dh.col.phone"), render: (r) => <Ltr>{r.phone ?? "—"}</Ltr> },
    { key: "last_doctor", header: t("dh.col.lastDoctor"), sortable: true, render: (r) => <>{r.last_doctor || "—"} {r.own && <StatusChip status="ok" className="ms-1">{t("dh.mine")}</StatusChip>}</> },
    { key: "last_seen", header: t("dh.col.lastSeen"), sortable: true, render: (r) => <Ltr>{fmtD(r.last_seen)}</Ltr> },
  ];
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("nav.deptPatients")}{list.data ? ` · ${list.data.department.name}` : ""}</h1>
        <p className="text-sm text-muted-foreground">{t("dh.patientsDesc")}</p>
      </div>
      <div className="relative max-w-md">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("dh.searchPh")} className="ps-9" aria-label={t("dh.searchPh")} />
      </div>
      <Banner tone="info" title={t("dh.auditNote")} />
      {list.error && <Banner tone="danger" title={(list.error as { message?: string }).message ?? t("dh.failed")} />}
      {list.isLoading ? <Skeleton className="h-64 w-full" /> : (
        <DataTable rows={list.data?.rows ?? []} columns={columns} searchKeys={["full_name", "mrn", "phone"]} pageSize={20} />
      )}
    </div>
  );
}
