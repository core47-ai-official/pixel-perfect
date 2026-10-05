import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileUp, Plus } from "lucide-react";
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
import { useDepartmentsData } from "@/lib/departments-data";
import { parseCsv } from "@/lib/formulary";
import { ROOM_CLASSES, TARIFF_CATEGORIES, TARIFF_CSV_COLUMNS, rs, useTariffs, validateTariffRow, type Tariff } from "@/lib/tariffs";

export const Route = createFileRoute("/_authenticated/_app/tariffs")({
  head: () => ({ meta: [{ title: "Tariffs — MediCore HMS" }, { name: "description", content: "Hospital price list for consultations, tests, rooms and procedures." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("tariffs")}>
      <TariffsPage />
    </RequireRole>
  ),
});

type Row = Tariff & { deptName: string; statusKey: string };

function TariffsPage() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const canEdit = hasRole("admin") || hasRole("super_admin");
  const tariffs = useTariffs();
  const { depts } = useDepartmentsData();
  const [editing, setEditing] = useState<Tariff | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const deptMap = new Map((depts.data ?? []).map((d) => [d.id, d.name]));
  const rows: Row[] = (tariffs.data ?? []).map((x) => ({ ...x, deptName: x.department_id ? deptMap.get(x.department_id) ?? "" : "", statusKey: x.is_active ? "active" : "inactive" }));

  const columns: Column<Row>[] = [
    { key: "code", header: t("tf.code"), sortable: true, render: (r) => <Ltr className="font-mono text-xs">{r.code}</Ltr> },
    { key: "name", header: t("tf.name"), sortable: true, render: (r) => canEdit ? <button className="text-start font-medium hover:underline" onClick={() => setEditing(r)}>{r.name}</button> : <span className="font-medium">{r.name}</span> },
    { key: "category", header: t("tf.category"), sortable: true, render: (r) => t(`tf.categories.${r.category}`) },
    { key: "deptName", header: t("tf.department"), render: (r) => r.deptName || "—" },
    { key: "room_class", header: t("tf.roomClass"), render: (r) => (r.room_class ? t(`wd.types.${r.room_class}`, r.room_class) : "—") },
    { key: "price", header: t("tf.price"), sortable: true, numeric: true, render: (r) => <Ltr>{rs(r.price)}</Ltr> },
    { key: "statusKey", header: t("tf.status"), render: (r) => <StatusChip status={r.is_active ? "ok" : "inactive"}>{t(r.is_active ? "tf.active" : "tf.inactive")}</StatusChip> },
  ];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">{t("tf.intro")}</p>
        {canEdit && <div className="ms-auto flex gap-2">
          <Button variant="outline" onClick={() => setImporting(true)}><FileUp />{t("tf.import")}</Button>
          <Button onClick={() => setEditing("new")}><Plus />{t("tf.add")}</Button>
        </div>}
      </div>
      {tariffs.isLoading ? <Skeleton className="h-64" /> : (
        <DataTable rows={rows} columns={columns} pageSize={20} searchKeys={["code", "name", "deptName"]}
          filters={[
            { key: "category", label: t("tf.category"), options: TARIFF_CATEGORIES.map((v) => ({ value: v, label: t(`tf.categories.${v}`) })) },
            { key: "statusKey", label: t("tf.status"), options: [{ value: "active", label: t("tf.active") }, { value: "inactive", label: t("tf.inactive") }] },
          ]} />
      )}
      {editing && <TariffForm key={editing === "new" ? "new" : editing.id} target={editing} onClose={() => setEditing(null)} />}
      {importing && <TariffImport onClose={() => setImporting(false)} />}
    </div>
  );
}

function TariffForm({ target, onClose }: { target: Tariff | "new"; onClose: () => void }) {
  const { t } = useTranslation();
  const { depts } = useDepartmentsData();
  const init = target === "new" ? null : target;
  const [f, setF] = useState({
    code: init?.code ?? "", name: init?.name ?? "", category: init?.category ?? "consultation",
    department_id: init?.department_id ?? "none", room_class: init?.room_class ?? "none", price: init ? String(init.price) : "", is_active: init?.is_active ?? true,
  });
  const save = useEdgeFunction("upsert-tariff", { invalidate: [["tariffs"]], successMessage: t("tf.saved") });
  const submit = async () => {
    if (!f.code.trim() || f.name.trim().length < 2 || f.price === "" || Number(f.price) < 0) { toast.error(t("tf.required")); return; }
    try {
      await save.mutateAsync({ id: init?.id, ...f, price: Number(f.price), department_id: f.department_id === "none" ? null : f.department_id, room_class: f.room_class === "none" ? null : f.room_class });
      onClose();
    } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={init ? t("tf.edit") : t("tf.add")}
      footer={<><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button><Button onClick={submit} disabled={save.isPending}>{t("wd.save")}</Button></>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="tf-code">{t("tf.code")} *</Label>
          <Input id="tf-code" dir="ltr" className="font-mono uppercase" value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="tf-name">{t("tf.name")} *</Label>
          <Input id="tf-name" value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>{t("tf.category")}</Label>
          <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TARIFF_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`tf.categories.${c}`)}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label>{t("tf.department")}</Label>
          <Select value={f.department_id} onValueChange={(v) => setF({ ...f, department_id: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">{t("tf.any")}</SelectItem>{(depts.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label>{t("tf.roomClass")}</Label>
          <Select value={f.room_class} onValueChange={(v) => setF({ ...f, room_class: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">{t("tf.any")}</SelectItem>{ROOM_CLASSES.map((c) => <SelectItem key={c} value={c}>{t(`wd.types.${c}`, c)}</SelectItem>)}</SelectContent></Select>
          <p className="text-xs text-muted-foreground">{t("tf.roomClassHint")}</p></div>
        <div className="space-y-1.5"><Label htmlFor="tf-price">{t("tf.priceRs")} *</Label>
          <Input id="tf-price" type="number" inputMode="decimal" min={0} step="0.01" dir="ltr" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
        <div className="flex items-center justify-between rounded-md border p-3"><Label htmlFor="tf-active">{t("tf.active")}</Label>
          <Switch id="tf-active" checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} /></div>
      </div>
    </SidePanel>
  );
}

function TariffImport({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { depts } = useDepartmentsData();
  const deptNames = useMemo(() => new Set((depts.data ?? []).map((d) => d.name.trim().toLowerCase())), [depts.data]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const run = useEdgeFunction<{ inserted: number; updated: number; errors: { row: number; message: string }[]; saved: boolean }>("import-tariffs", { invalidate: [["tariffs"]] });
  const checked = rows.map((r, i) => ({ r, line: i + 2, err: validateTariffRow(r, deptNames) }));
  const bad = checked.filter((x) => x.err);

  const onFile = async (file: File) => {
    const lines = parseCsv(await file.text());
    if (lines.length < 2) { toast.error(t("tf.csvEmpty")); return; }
    const head = (lines[0] ?? []).map((h) => h.trim().toLowerCase());
    if (!head.includes("code") || !head.includes("name") || !head.includes("price")) { toast.error(t("tf.csvHeader")); return; }
    setFileName(file.name);
    setRows(lines.slice(1).map((l) => Object.fromEntries(head.map((h, i) => [h, (l[i] ?? "").trim()]))));
  };
  const submit = async () => {
    try {
      const res = await run.mutateAsync({ rows });
      if (!res.saved) { toast.error(t("tf.importErrors", { n: res.errors.length })); return; }
      toast.success(t("tf.imported", { inserted: res.inserted, updated: res.updated }));
      onClose();
    } catch { /* shown */ }
  };
  const sample = `${TARIFF_CSV_COLUMNS.join(",")}\nCONS-GEN,General OPD consultation,consultation,Medicine,,1500,yes\nROOM-PVT,Private room (per day),room,,private,8000,yes`;

  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={t("tf.import")}
      footer={<><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button><Button onClick={submit} disabled={!rows.length || bad.length > 0 || run.isPending}>{t("tf.importN", { n: rows.length })}</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t("tf.csvHelp")}</p>
        <pre dir="ltr" className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{sample}</pre>
        <Input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        {fileName && <p><Ltr>{fileName}</Ltr> · {t("tf.rowsFound", { n: rows.length })}</p>}
        {bad.length > 0 && (
          <div className="space-y-1 rounded-md border border-urgent p-3">
            <p className="font-medium text-urgent">{t("tf.errorRows", { n: bad.length })}</p>
            {bad.slice(0, 50).map((x) => <p key={x.line} className="text-xs">{t("tf.line")} <Ltr>{x.line}</Ltr>: {t(`tf.errors.${x.err}`)} <Ltr className="text-muted-foreground">{x.r.code}</Ltr></p>)}
          </div>
        )}
        {rows.length > 0 && bad.length === 0 && (
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {checked.slice(0, 100).map((x) => (
              <div key={x.line} className="flex justify-between gap-2 border-b px-3 py-1.5 text-xs last:border-0">
                <Ltr className="font-mono">{x.r.code}</Ltr><span className="flex-1 truncate">{x.r.name}</span><Ltr>{x.r.price}</Ltr>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("tf.importNote")}</p>
      </div>
    </SidePanel>
  );
}
