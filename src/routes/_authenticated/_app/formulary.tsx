import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileUp, Plus, Trash2, Zap } from "lucide-react";
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
import {
  CSV_COLUMNS, MED_FORMS, MED_ROUTES, SEVERITIES, parseCsv, useInteractions, useMedicines, validateCsvRow,
  type CsvMedicine, type Medicine,
} from "@/lib/formulary";

export const Route = createFileRoute("/_authenticated/_app/formulary")({
  head: () => ({ meta: [{ title: "Formulary — MediCore HMS" }, { name: "description", content: "Hospital medicine list, prices and drug interactions." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("formulary")}>
      <FormularyPage />
    </RequireRole>
  ),
});

type Row = Medicine & { name: string; statusKey: string; groupsText: string };
const pkr = (n: number) => n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function FormularyPage() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const canEdit = hasRole("super_admin") || hasRole("admin") || hasRole("pharmacist");
  const meds = useMedicines();
  const [editing, setEditing] = useState<Medicine | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [ix, setIx] = useState(false);

  const rows: Row[] = (meds.data ?? []).map((m) => ({
    ...m,
    name: `${m.generic_name} ${m.brand_name ?? ""}`,
    statusKey: m.is_active ? "active" : "inactive",
    groupsText: m.interaction_group.join(" "),
  }));
  const columns: Column<Row>[] = [
    { key: "generic_name", header: t("fm.generic"), sortable: true, render: (m) => <Ltr className="font-medium">{m.generic_name}</Ltr> },
    { key: "brand_name", header: t("fm.brand"), sortable: true, render: (m) => <Ltr>{m.brand_name ?? "—"}</Ltr> },
    { key: "strength", header: t("fm.strength"), render: (m) => <Ltr>{m.strength ?? "—"}</Ltr> },
    { key: "form", header: t("fm.form"), sortable: true, render: (m) => t(`fm.forms.${m.form}`, { defaultValue: m.form }) },
    { key: "route", header: t("fm.route"), render: (m) => t(`fm.routes.${m.route}`, { defaultValue: m.route }) },
    { key: "unit_price", header: t("fm.price"), numeric: true, sortable: true, render: (m) => <Ltr>{pkr(m.unit_price)}</Ltr> },
    { key: "drap_reg_no", header: t("fm.drap"), render: (m) => <Ltr className="font-mono text-xs">{m.drap_reg_no ?? "—"}</Ltr> },
    { key: "statusKey", header: t("fm.status"), render: (m) => <StatusChip tone={m.is_active ? "ok" : "inactive"}>{m.is_active ? t("fm.active") : t("fm.inactive")}</StatusChip> },
  ];
  if (canEdit) columns.push({ key: "id", header: "", render: (m) => <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>{t("fm.editShort")}</Button> });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("fm.intro")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setIx(true)}><Zap className="size-4" />{t("fm.interactions")}</Button>
          {canEdit && <Button variant="outline" onClick={() => setImporting(true)}><FileUp className="size-4" />{t("fm.import")}</Button>}
          {canEdit && <Button onClick={() => setEditing("new")}><Plus className="size-4" />{t("fm.add")}</Button>}
        </div>
      </div>
      {meds.isLoading ? <Skeleton className="h-64 w-full" /> : meds.isError ? (
        <p className="text-sm text-destructive">{t("fm.loadError")}</p>
      ) : (
        <DataTable rows={rows} columns={columns} searchKeys={["name", "drap_reg_no", "groupsText"]}
          filters={[
            { key: "form", label: t("fm.form"), options: MED_FORMS.map((v) => ({ value: v, label: t(`fm.forms.${v}`) })) },
            { key: "statusKey", label: t("fm.status"), options: [{ value: "active", label: t("fm.active") }, { value: "inactive", label: t("fm.inactive") }] },
          ]} />
      )}
      {editing && <MedicineForm key={editing === "new" ? "new" : editing.id} target={editing} onClose={() => setEditing(null)} />}
      {importing && <CsvImport onClose={() => setImporting(false)} />}
      {ix && <InteractionsPanel canEdit={canEdit} onClose={() => setIx(false)} />}
    </div>
  );
}

function MedicineForm({ target, onClose }: { target: Medicine | "new"; onClose: () => void }) {
  const { t } = useTranslation();
  const m = target === "new" ? null : target;
  const [f, setF] = useState({
    generic_name: m?.generic_name ?? "", brand_name: m?.brand_name ?? "", strength: m?.strength ?? "",
    form: m?.form ?? "tablet", route: m?.route ?? "oral", unit_price: m ? String(m.unit_price) : "",
    drap_reg_no: m?.drap_reg_no ?? "", interaction_group: m?.interaction_group.join(", ") ?? "", is_active: m?.is_active ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = useEdgeFunction("upsert-medicine", { invalidate: [["medicines"]], successMessage: t("fm.saved") });
  const submit = async () => {
    if (f.generic_name.trim().length < 2) { toast.error(t("fm.genericRequired")); return; }
    const price = Number(f.unit_price || 0);
    if (!Number.isFinite(price) || price < 0) { toast.error(t("fm.err.price")); return; }
    try {
      await save.mutateAsync({ id: m?.id, ...f, unit_price: price, interaction_group: f.interaction_group.split(",") });
      onClose();
    } catch { /* shown by hook */ }
  };
  const text = (k: "generic_name" | "brand_name" | "strength" | "drap_reg_no", label: string) => (
    <div className="space-y-1.5"><Label htmlFor={`m-${k}`}>{label}</Label>
      <Input id={`m-${k}`} dir="ltr" value={f[k]} onChange={(e) => set(k, e.target.value)} maxLength={200} /></div>
  );
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={m ? t("fm.edit") : t("fm.add")}
      footer={<div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>{t("fm.cancel")}</Button>
        <Button onClick={submit} disabled={save.isPending}>{t("fm.save")}</Button>
      </div>}>
      <div className="space-y-4">
        {text("generic_name", t("fm.generic"))}
        {text("brand_name", t("fm.brand"))}
        {text("strength", t("fm.strength"))}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>{t("fm.form")}</Label>
            <Select value={f.form} onValueChange={(v) => set("form", v)}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MED_FORMS.map((v) => <SelectItem key={v} value={v}>{t(`fm.forms.${v}`)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>{t("fm.route")}</Label>
            <Select value={f.route} onValueChange={(v) => set("route", v)}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MED_ROUTES.map((v) => <SelectItem key={v} value={v}>{t(`fm.routes.${v}`)}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="m-price">{t("fm.price")}</Label>
          <Input id="m-price" dir="ltr" inputMode="decimal" value={f.unit_price} onChange={(e) => set("unit_price", e.target.value)} /></div>
        {text("drap_reg_no", t("fm.drap"))}
        <div className="space-y-1.5"><Label htmlFor="m-groups">{t("fm.groups")}</Label>
          <Input id="m-groups" dir="ltr" value={f.interaction_group} onChange={(e) => set("interaction_group", e.target.value)} />
          <p className="text-xs text-muted-foreground">{t("fm.groupsHint")}</p></div>
        <div className="flex items-center justify-between"><Label htmlFor="m-active">{t("fm.active")}</Label>
          <Switch id="m-active" checked={f.is_active} onCheckedChange={(v) => set("is_active", v)} /></div>
      </div>
    </SidePanel>
  );
}

function CsvImport({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [parsed, setParsed] = useState<{ valid: CsvMedicine[]; errors: { row: number; problem: string; name: string }[] } | null>(null);
  const run = useEdgeFunction<{ imported: number; skipped: number }, { rows: CsvMedicine[] }>("import-medicines", { invalidate: [["medicines"]] });

  const onFile = async (file: File) => {
    const lines = parseCsv(await file.text());
    if (!lines.length) { toast.error(t("fm.csvEmpty")); return; }
    const first = lines[0].map((h) => h.trim().toLowerCase());
    const hasHeader = first.includes("generic_name");
    const cols = hasHeader ? first : [...CSV_COLUMNS];
    const valid: CsvMedicine[] = [];
    const errors: { row: number; problem: string; name: string }[] = [];
    lines.slice(hasHeader ? 1 : 0).forEach((cells, i) => {
      const r: CsvMedicine = {};
      cols.forEach((c, j) => { r[c] = (cells[j] ?? "").trim(); });
      const problem = validateCsvRow(r);
      if (problem) errors.push({ row: i + (hasHeader ? 2 : 1), problem, name: r.generic_name ?? "" });
      else valid.push(r);
    });
    if (!valid.length && !errors.length) { toast.error(t("fm.csvEmpty")); return; }
    setParsed({ valid, errors });
  };

  const submit = async () => {
    if (!parsed?.valid.length) return;
    try {
      const res = await run.mutateAsync({ rows: parsed.valid });
      toast.success(t("fm.csvDone", { imported: res.imported }));
      onClose();
    } catch { /* shown by hook */ }
  };

  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={t("fm.csvTitle")}
      footer={<div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>{t("fm.cancel")}</Button>
        <Button onClick={submit} disabled={!parsed?.valid.length || run.isPending}>{t("fm.csvImport", { count: parsed?.valid.length ?? 0 })}</Button>
      </div>}>
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t("fm.csvHint")}</p>
        <div className="space-y-1.5"><Label htmlFor="csv">{t("fm.csvChoose")}</Label>
          <Input id="csv" type="file" accept=".csv,text/csv" onChange={(e) => { const file = e.target.files?.[0]; if (file) void onFile(file); }} /></div>
        {parsed && (
          <>
            <p className="font-medium text-ok">{t("fm.csvValid", { count: parsed.valid.length })}</p>
            {parsed.valid.length > 0 && (
              <div className="max-h-56 overflow-auto rounded-md border">
                <table className="w-full text-xs"><thead className="bg-muted"><tr>
                  <th className="p-1.5 text-start">{t("fm.generic")}</th><th className="p-1.5 text-start">{t("fm.strength")}</th><th className="p-1.5 text-end">{t("fm.price")}</th>
                </tr></thead><tbody>
                  {parsed.valid.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t"><td className="p-1.5"><Ltr>{r.generic_name} {r.brand_name}</Ltr></td><td className="p-1.5"><Ltr>{r.strength}</Ltr></td><td className="p-1.5 text-end"><Ltr>{r.unit_price}</Ltr></td></tr>
                  ))}
                </tbody></table>
              </div>
            )}
            {parsed.errors.length > 0 && (
              <>
                <p className="font-medium text-destructive">{t("fm.csvErrors", { count: parsed.errors.length })}</p>
                <div className="max-h-48 overflow-auto rounded-md border border-destructive/40">
                  <table className="w-full text-xs"><thead className="bg-destructive/10"><tr>
                    <th className="p-1.5 text-start">{t("fm.csvRow")}</th><th className="p-1.5 text-start">{t("fm.generic")}</th><th className="p-1.5 text-start">{t("fm.csvProblem")}</th>
                  </tr></thead><tbody>
                    {parsed.errors.map((e) => (
                      <tr key={e.row} className="border-t"><td className="p-1.5"><Ltr>{e.row}</Ltr></td><td className="p-1.5"><Ltr>{e.name || "—"}</Ltr></td><td className="p-1.5">{t(`fm.err.${e.problem}`)}</td></tr>
                    ))}
                  </tbody></table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </SidePanel>
  );
}

const SEV_TONE = { minor: "inactive", moderate: "caution", major: "warning", contraindicated: "urgent" } as const;

function InteractionsPanel({ canEdit, onClose }: { canEdit: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const list = useInteractions();
  const [f, setF] = useState({ group_a: "", group_b: "", severity: "moderate", note: "" });
  const save = useEdgeFunction("upsert-drug-interaction", { invalidate: [["drug-interactions"]], successMessage: t("fm.ixSaved") });
  const add = async () => {
    if (!f.group_a.trim() || !f.group_b.trim()) { toast.error(t("fm.ixNeedGroups")); return; }
    try { await save.mutateAsync(f); setF({ group_a: "", group_b: "", severity: "moderate", note: "" }); } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={t("fm.ixTitle")}>
      <div className="space-y-4 text-sm">
        {canEdit && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label htmlFor="ix-a">{t("fm.ixGroupA")}</Label><Input id="ix-a" dir="ltr" value={f.group_a} onChange={(e) => setF({ ...f, group_a: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="ix-b">{t("fm.ixGroupB")}</Label><Input id="ix-b" dir="ltr" value={f.group_b} onChange={(e) => setF({ ...f, group_b: e.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label>{t("fm.ixSeverity")}</Label>
              <Select value={f.severity} onValueChange={(v) => setF({ ...f, severity: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{t(`fm.sev.${s}`)}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label htmlFor="ix-n">{t("fm.ixNote")}</Label><Input id="ix-n" dir="auto" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={1000} /></div>
            <Button size="sm" onClick={add} disabled={save.isPending}><Plus className="size-4" />{t("fm.ixAdd")}</Button>
          </div>
        )}
        {list.isLoading ? <Skeleton className="h-32" /> : !list.data?.length ? (
          <p className="text-muted-foreground">{t("fm.ixEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {list.data.map((x) => (
              <li key={x.id} className="rounded-md border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Ltr className="font-medium">{x.group_a} ↔ {x.group_b}</Ltr>
                  <div className="flex items-center gap-1">
                    <StatusChip tone={SEV_TONE[x.severity as keyof typeof SEV_TONE] ?? "inactive"}>{t(`fm.sev.${x.severity}`, { defaultValue: x.severity })}</StatusChip>
                    {canEdit && <Button size="icon" variant="ghost" aria-label={t("dx.remove")} onClick={() => save.mutate({ id: x.id, delete: true })}><Trash2 className="size-4" /></Button>}
                  </div>
                </div>
                {x.note && <p className="mt-1 text-muted-foreground" dir="auto">{x.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SidePanel>
  );
}
