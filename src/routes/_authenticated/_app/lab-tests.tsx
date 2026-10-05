import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { DataTable, type Column } from "@/components/mc/data-table";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { useLabTests, type LabTest } from "@/lib/lab";

export const Route = createFileRoute("/_authenticated/_app/lab-tests")({
  head: () => ({ meta: [{ title: "Lab tests — MediCore HMS" }, { name: "description", content: "Lab and radiology test catalogue with prices and turnaround." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("labTests")}>
      <LabTestsPage />
    </RequireRole>
  ),
});

type Row = LabTest & { statusKey: string };

function LabTestsPage() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const canEdit = hasRole("super_admin") || hasRole("admin");
  const tests = useLabTests();
  const [editing, setEditing] = useState<LabTest | "new" | null>(null);
  const rows: Row[] = (tests.data ?? []).map((x) => ({ ...x, statusKey: x.is_active ? "active" : "inactive" }));
  const columns: Column<Row>[] = [
    { key: "code", header: t("lab.code"), sortable: true, render: (x) => <Ltr className="font-mono font-semibold">{x.code}</Ltr> },
    { key: "name", header: t("lab.test"), sortable: true, render: (x) => <Ltr>{x.name}</Ltr> },
    { key: "category", header: t("lab.category"), render: (x) => t(`lab.cat.${x.category}`) },
    { key: "sample_type", header: t("lab.sample"), render: (x) => <Ltr>{x.sample_type ?? "—"}</Ltr> },
    { key: "price", header: t("lab.price"), numeric: true, sortable: true, render: (x) => <Ltr>{x.price.toLocaleString("en-PK")}</Ltr> },
    { key: "turnaround_hours", header: t("lab.tat"), numeric: true, sortable: true, render: (x) => <Ltr>{x.turnaround_hours}h</Ltr> },
    { key: "statusKey", header: t("fm.status"), render: (x) => <StatusChip status={x.is_active ? "ok" : "inactive"}>{x.is_active ? t("fm.active") : t("fm.inactive")}</StatusChip> },
  ];
  if (canEdit) columns.push({ key: "id", header: "", render: (x) => <Button size="sm" variant="ghost" onClick={() => setEditing(x)}>{t("fm.editShort")}</Button> });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("lab.intro")}</p>
        {canEdit && <Button onClick={() => setEditing("new")}><Plus className="size-4" />{t("lab.add")}</Button>}
      </div>
      {tests.isLoading ? <Skeleton className="h-64" /> : (
        <DataTable rows={rows} columns={columns} searchKeys={["code", "name"]}
          filters={[{ key: "category", label: t("lab.category"), options: ["lab", "radiology"].map((v) => ({ value: v, label: t(`lab.cat.${v}`) })) }]} />
      )}
      {editing && <TestForm key={editing === "new" ? "new" : editing.id} target={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TestForm({ target, onClose }: { target: LabTest | "new"; onClose: () => void }) {
  const { t } = useTranslation();
  const x = target === "new" ? null : target;
  const [f, setF] = useState({
    code: x?.code ?? "", name: x?.name ?? "", category: x?.category ?? "lab", sample_type: x?.sample_type ?? "",
    price: x ? String(x.price) : "", reference_range: x?.reference_range ?? "", turnaround_hours: String(x?.turnaround_hours ?? 24), is_active: x?.is_active ?? true,
  });
  const save = useEdgeFunction("upsert-lab-test", { invalidate: [["lab-tests"]], successMessage: t("lab.saved") });
  const submit = async () => {
    if (!f.code.trim() || f.name.trim().length < 2) { toast.error(t("lab.required")); return; }
    try { await save.mutateAsync({ id: x?.id, ...f, price: Number(f.price || 0), turnaround_hours: Number(f.turnaround_hours || 0) }); onClose(); } catch { /* shown */ }
  };
  const field = (k: "code" | "name" | "sample_type" | "price" | "reference_range" | "turnaround_hours", label: string, numeric = false) => (
    <div className="space-y-1.5"><Label htmlFor={`lt-${k}`}>{label}</Label>
      <Input id={`lt-${k}`} dir="ltr" inputMode={numeric ? "decimal" : undefined} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={x ? t("lab.edit") : t("lab.add")}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t("fm.cancel")}</Button><Button onClick={submit} disabled={save.isPending}>{t("fm.save")}</Button></div>}>
      <div className="space-y-4">
        {field("code", t("lab.code"))}
        {field("name", t("lab.test"))}
        <div className="space-y-1.5"><Label>{t("lab.category")}</Label>
          <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["lab", "radiology"].map((v) => <SelectItem key={v} value={v}>{t(`lab.cat.${v}`)}</SelectItem>)}</SelectContent></Select></div>
        {field("sample_type", t("lab.sample"))}
        {field("price", t("lab.price"), true)}
        {field("reference_range", t("lab.range"))}
        {field("turnaround_hours", t("lab.tat"), true)}
        <div className="flex items-center justify-between"><Label htmlFor="lt-active">{t("fm.active")}</Label>
          <Switch id="lt-active" checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} /></div>
      </div>
    </SidePanel>
  );
}
