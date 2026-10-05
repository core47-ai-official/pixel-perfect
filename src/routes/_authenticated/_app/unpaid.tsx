import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileSpreadsheet, MessageSquarePlus } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/mc/data-table";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { formatPkr } from "@/lib/patient-summary";
import { useDepartmentsData } from "@/lib/departments-data";

export const Route = createFileRoute("/_authenticated/_app/unpaid")({
  head: () => ({ meta: [
    { title: "Unpaid balances — MediCore HMS" },
    { name: "description", content: "Open patient balances by age with follow-up notes and Excel export." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("unpaid")}>
      <UnpaidPage />
    </RequireRole>
  ),
});

type Bucket = "b0_30" | "b31_60" | "b60";
interface Row {
  id: string; invoice_no: string; patient_id: string; patient: string; mrn: string; phone: string;
  department_id: string | null; department: string; payer_type: string; created_at: string; age: number; bucket: Bucket;
  total: number; paid: number; balance: number; last_followup: { note: string; by_name: string; created_at: string; count: number } | null;
}
interface Report { rows: Row[]; totals: Record<Bucket | "total" | "count", number>; generated_at: string }
interface Followup { id: string; note: string; by_name: string; created_at: string }

const PAYERS = ["self", "welfare", "panel", "health_card"];
const BUCKET_TONE: Record<Bucket, "ok" | "warning" | "urgent"> = { b0_30: "ok", b31_60: "warning", b60: "urgent" };
const fmtD = (s: string) => { const d = new Date(s); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };

function UnpaidPage() {
  const { t } = useTranslation();
  const [dept, setDept] = useState("all");
  const [payer, setPayer] = useState("all");
  const [open, setOpen] = useState<Row | null>(null);
  const depts = useDepartmentsData();
  const report = useQuery({
    queryKey: ["unpaid-report", dept, payer], retry: false,
    queryFn: () => callEdgeFunction<Report>("get-unpaid-report", { department_id: dept, payer_type: payer }),
  });
  const rows = report.data?.rows ?? [];
  const deptList = (depts.data as { departments?: { id: string; name: string }[] } | undefined)?.departments ?? [];

  const columns: Column<Row>[] = [
    { key: "invoice_no", header: t("unpaid.col.invoice_no"), sortable: true, render: (r) => <Ltr>{r.invoice_no}</Ltr> },
    { key: "patient", header: t("unpaid.col.patient"), sortable: true, render: (r) => (
      <Link to="/patients/$patientId" params={{ patientId: r.patient_id }} className="font-medium hover:underline">{r.patient} <span className="text-xs text-muted-foreground"><Ltr>{r.mrn}</Ltr></span></Link>) },
    { key: "department", header: t("unpaid.col.department"), sortable: true, render: (r) => r.department || "—" },
    { key: "payer_type", header: t("unpaid.col.payer_type"), render: (r) => t(`bill.payers.${r.payer_type}`, r.payer_type) },
    { key: "age", header: t("unpaid.col.age"), sortable: true, numeric: true, render: (r) => <StatusChip status={BUCKET_TONE[r.bucket]}><Ltr>{r.age}</Ltr></StatusChip> },
    { key: "balance", header: t("unpaid.col.balance"), sortable: true, numeric: true, render: (r) => <Ltr className="font-semibold">{formatPkr(r.balance)}</Ltr> },
    { key: "last_followup", header: t("unpaid.col.last"), render: (r) => (
      <button type="button" onClick={() => setOpen(r)} className="max-w-56 truncate text-start text-sm hover:underline">
        {r.last_followup ? <>{r.last_followup.note} <span className="text-xs text-muted-foreground">({r.last_followup.count})</span></> : <span className="inline-flex items-center gap-1 text-muted-foreground"><MessageSquarePlus className="size-4" />{t("unpaid.addNote")}</span>}
      </button>) },
  ];

  const exportXlsx = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Unpaid balances");
    const keys = ["invoice_no", "patient", "mrn", "phone", "department", "payer_type", "created", "age", "bucket", "total", "paid", "balance", "last"] as const;
    ws.columns = keys.map((k) => ({ header: t(`unpaid.col.${k}`), key: k, width: ["patient", "last"].includes(k) ? 30 : 14 }));
    rows.forEach((r) => ws.addRow({ ...r, payer_type: t(`bill.payers.${r.payer_type}`, r.payer_type), created: new Date(r.created_at),
      bucket: t(`unpaid.bucket.${r.bucket}`), last: r.last_followup?.note ?? "" }));
    const n = rows.length + 1;
    ws.addRow({ invoice_no: t("unpaid.bucket.total"), total: { formula: `SUM(J2:J${n})` }, paid: { formula: `SUM(K2:K${n})` }, balance: { formula: `SUM(L2:L${n})` } }).font = { bold: true };
    ws.getRow(1).font = { bold: true };
    ws.getColumn("created").numFmt = "dd/mm/yyyy";
    ["total", "paid", "balance"].forEach((k) => (ws.getColumn(k).numFmt = '"Rs" #,##0;("Rs" #,##0);-'));
    ws.views = [{ state: "frozen", ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `unpaid-balances-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const tot = report.data?.totals;
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{t("unpaid.title")}</h1><p className="text-sm text-muted-foreground">{t("unpaid.desc")}</p></div>
        <Button variant="outline" disabled={!rows.length} onClick={() => void exportXlsx()}><FileSpreadsheet /> {t("unpaid.export")}</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {(["b0_30", "b31_60", "b60", "total"] as const).map((k) => (
          <div key={k} className={`rounded-staff border bg-card p-3 ${k === "b60" && tot?.b60 ? "border-urgent/40" : ""}`}>
            <p className="text-xs text-muted-foreground">{t(`unpaid.bucket.${k}`)}</p>
            <p className="text-xl font-semibold"><Ltr>{formatPkr(tot?.[k] ?? 0)}</Ltr></p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="space-y-1"><Label>{t("unpaid.dept")}</Label>
          <Select value={dept} onValueChange={setDept}><SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t("unpaid.all")}</SelectItem><SelectItem value="none">{t("unpaid.noDept")}</SelectItem>
              {deptList.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label>{t("unpaid.payer")}</Label>
          <Select value={payer} onValueChange={setPayer}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t("unpaid.all")}</SelectItem>
              {PAYERS.map((p) => <SelectItem key={p} value={p}>{t(`bill.payers.${p}`, p)}</SelectItem>)}</SelectContent></Select></div>
      </div>

      {report.error && <Banner tone="danger" title={(report.error as { message?: string }).message ?? t("cash.failed")} />}
      <DataTable rows={rows} columns={columns} searchKeys={["invoice_no", "patient", "mrn", "phone"]} pageSize={20}
        filters={[{ key: "bucket", label: t("unpaid.col.bucket"), options: (["b0_30", "b31_60", "b60"] as const).map((b) => ({ value: b, label: t(`unpaid.bucket.${b}`) })) }]} />

      {open && <FollowupPanel row={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function FollowupPanel({ row, onClose }: { row: Row; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ["unpaid-followups", row.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("unpaid_followups" as never).select("id, note, by_name, created_at").eq("invoice_id", row.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Followup[];
    },
  });
  const save = async () => {
    setBusy(true);
    try {
      await callEdgeFunction("add-unpaid-followup", { invoice_id: row.id, note });
      toast.success(t("unpaid.saved")); setNote("");
      void qc.invalidateQueries({ queryKey: ["unpaid-followups", row.id] });
      void qc.invalidateQueries({ queryKey: ["unpaid-report"] });
    } catch (e) { toast.error((e as { message?: string }).message ?? t("cash.failed")); } finally { setBusy(false); }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={t("unpaid.followups")}
      footer={<Button disabled={busy || note.trim().length < 3} onClick={() => void save()}><MessageSquarePlus /> {t("unpaid.addNote")}</Button>}>
      <div className="space-y-4">
        <div className="rounded-staff border p-3 text-sm">
          <p className="font-medium">{row.patient} · <Ltr>{row.invoice_no}</Ltr></p>
          <p className="text-muted-foreground">{t("unpaid.col.balance")}: <Ltr>{formatPkr(row.balance)}</Ltr> · {t("unpaid.col.age")}: <Ltr>{row.age}</Ltr> {row.phone && <>· <Ltr>{row.phone}</Ltr></>}</p>
        </div>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("unpaid.notePh")} />
        {!list.data?.length ? <p className="text-sm text-muted-foreground">{t("unpaid.noNotes")}</p> : (
          <ul className="space-y-2">
            {list.data.map((f) => (
              <li key={f.id} className="rounded-staff border p-2 text-sm">
                <p>{f.note}</p>
                <p className="text-xs text-muted-foreground">{f.by_name} · <Ltr>{fmtD(f.created_at)}</Ltr></p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SidePanel>
  );
}
