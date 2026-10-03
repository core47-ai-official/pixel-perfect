import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { DataTable, type Column } from "@/components/mc/data-table";
import { SidePanel } from "@/components/mc/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { DEPT_TYPES, useDepartmentsData, type Dept } from "@/lib/departments-data";

export const Route = createFileRoute("/_authenticated/_app/departments")({
  head: () => ({ meta: [{ title: "Departments — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("departments")}>
      <DepartmentsPage />
    </RequireRole>
  ),
});

type Row = Dept & { headName: string; doctorCount: number };

function DepartmentsPage() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const canEdit = hasRole("super_admin") || hasRole("admin");
  const { depts, doctors, people } = useDepartmentsData();
  const [editing, setEditing] = useState<Dept | "new" | null>(null);
  const nameOf = (id: string | null) => (id && people.data?.find((p) => p.id === id)?.full_name) || "";

  const rows: Row[] = (depts.data ?? []).map((d) => ({
    ...d,
    headName: nameOf(d.head_doctor_id),
    doctorCount: (doctors.data ?? []).filter((x) => x.department_id === d.id).length,
  }));
  const columns: Column<Row>[] = [
    { key: "name", header: t("dept.name"), sortable: true, render: (d) => <span className="font-medium">{d.name}</span> },
    { key: "type", header: t("dept.type"), sortable: true, render: (d) => t(`dept.types.${d.type}`, { defaultValue: d.type }) },
    { key: "headName", header: t("dept.head"), render: (d) => d.headName || <span className="text-muted-foreground">{d.head_doctor_id ? "—" : t("dept.noHead")}</span> },
    { key: "doctorCount", header: t("dept.doctors"), numeric: true, sortable: true },
  ];
  if (canEdit) columns.push({
    key: "id", header: "", render: (d) => <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>{t("dept.editShort")}</Button>,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("dept.intro")}</p>
        {canEdit && <Button onClick={() => setEditing("new")}><Plus className="size-4" />{t("dept.add")}</Button>}
      </div>
      {depts.isLoading ? <Skeleton className="h-64 w-full" /> : depts.isError ? (
        <p className="text-sm text-destructive">{t("dept.loadError")}</p>
      ) : (
        <DataTable rows={rows} columns={columns} searchKeys={["name", "headName"]}
          filters={[{ key: "type", label: t("dept.type"), options: DEPT_TYPES.map((v) => ({ value: v, label: t(`dept.types.${v}`) })) }]} />
      )}
      {editing && (
        <DeptForm key={editing === "new" ? "new" : editing.id} target={editing} onClose={() => setEditing(null)}
          doctors={(doctors.data ?? []).filter((d) => editing !== "new" && d.department_id === editing.id)
            .map((d) => ({ id: d.user_id, name: nameOf(d.user_id) || d.user_id.slice(0, 8) }))} />
      )}
    </div>
  );
}

function DeptForm({ target, onClose, doctors }: { target: Dept | "new"; onClose: () => void; doctors: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const d = target === "new" ? null : target;
  const [name, setName] = useState(d?.name ?? "");
  const [type, setType] = useState(d?.type ?? "clinical");
  const [head, setHead] = useState(d?.head_doctor_id ?? "none");
  const inv = { invalidate: [["departments"], ["doctors"]] };
  const save = useEdgeFunction<Dept, { id?: string | undefined; name: string; type: string }>("upsert-department", { ...inv, successMessage: t("dept.saved") });
  const setHeadFn = useEdgeFunction<unknown, { department_id: string; user_id: string | null }>("set-department-head", { ...inv, successMessage: t("dept.headSaved") });
  const busy = save.isPending || setHeadFn.isPending;

  const submit = async () => {
    if (name.trim().length < 2) { toast.error(t("dept.nameRequired")); return; }
    try {
      const unchanged = d && d.name === name.trim() && d.type === type;
      if (!unchanged) await save.mutateAsync({ id: d?.id, name: name.trim(), type });
      const newHead = head === "none" ? null : head;
      if (d && newHead !== d.head_doctor_id) await setHeadFn.mutateAsync({ department_id: d.id, user_id: newHead });
      onClose();
    } catch { /* error already shown */ }
  };

  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={d ? t("dept.edit") : t("dept.add")}
      footer={<div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>{t("dept.cancel")}</Button>
        <Button onClick={submit} disabled={busy}>{t("dept.save")}</Button>
      </div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>{t("dept.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></div>
        <div className="space-y-1.5"><Label>{t("dept.type")}</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{DEPT_TYPES.map((v) => <SelectItem key={v} value={v}>{t(`dept.types.${v}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>{t("dept.head")}</Label>
          {d ? (
            <>
              <Select value={head} onValueChange={setHead}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("dept.noHead")}</SelectItem>
                  {doctors.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("dept.headHint")}</p>
            </>
          ) : <p className="text-sm text-muted-foreground">{t("dept.headAfterSave")}</p>}
        </div>
      </div>
    </SidePanel>
  );
}
