import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { EmptyState } from "@/components/mc/empty-state";
import { Ltr } from "@/components/mc/ltr";
import { Barcode } from "@/components/mc/barcode";
import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMyContext } from "@/hooks/use-my-context";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { cn } from "@/lib/utils";

const DESC = "Lab worklist: collect samples, print barcode labels and track orders live.";
export const Route = createFileRoute("/_authenticated/_app/lab")({
  head: () => ({ meta: [
    { title: "Lab worklist — MediCore HMS" },
    { name: "description", content: DESC },
    { property: "og:title", content: "Lab worklist — MediCore HMS" },
    { property: "og:description", content: DESC },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("lab")}>
      <Worklist />
    </RequireRole>
  ),
});

interface Row {
  id: string; status: string; priority: string; created_at: string; sample_barcode: string | null; collected_at: string | null;
  rejected_reason: string | null; patient_id: string;
  lab_tests: { code: string; name: string; category: string; sample_type: string | null } | null;
  patients: { full_name: string; mrn: string; print_language: string | null } | null;
}
const STATUSES = ["ordered", "collected", "rejected", "resulted", "verified", "cancelled"];
const SELECT = "id, status, priority, created_at, sample_barcode, collected_at, rejected_reason, patient_id, lab_tests(code, name, category, sample_type), patients(full_name, mrn, print_language)";
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Worklist() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { context, roles } = useMyContext() as unknown as { context?: { hospital?: { id: string } }; roles?: string[] };
  const hid = context?.hospital?.id;
  const canAct = (roles ?? []).some((r) => ["lab_tech", "admin", "super_admin"].includes(r));
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [label, setLabel] = useState<Row | null>(null);
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["lab-worklist", hid, status],
    enabled: !!hid,
    queryFn: async () => {
      let s = supabase.from("orders").select(SELECT).eq("hospital_id", hid!).gte("created_at", new Date(Date.now() - 14 * 86400e3).toISOString());
      s = status === "open" ? s.in("status", ["ordered", "collected", "rejected"]) : s.eq("status", status);
      const { data, error } = await s.order("created_at", { ascending: true }).limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  useEffect(() => {
    if (!hid) return;
    const ch = supabase.channel(`lab-${hid}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `hospital_id=eq.${hid}` },
        () => void qc.invalidateQueries({ queryKey: ["lab-worklist"] }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [hid, qc]);

  const rows = useMemo(() => (q.data ?? [])
    .filter((r) => priority === "all" || r.priority === priority)
    .filter((r) => category === "all" || r.lab_tests?.category === category)
    .sort((a, b) => (a.priority === "urgent" ? 0 : 1) - (b.priority === "urgent" ? 0 : 1) || a.created_at.localeCompare(b.created_at)), [q.data, priority, category]);

  const collect = async (r: Row) => {
    setBusy(r.id);
    try {
      const res = await callEdgeFunction<Row>("collect-sample", { order_id: r.id });
      toast.success(t("lab.collected"));
      setLabel({ ...r, ...res });
      void qc.invalidateQueries({ queryKey: ["lab-worklist"] });
    } catch (e) { toast.error((e as EdgeError).message); } finally { setBusy(null); }
  };
  const reject = async () => {
    if (!rejecting) return;
    setBusy(rejecting.id);
    try {
      await callEdgeFunction("reject-sample", { order_id: rejecting.id, reason });
      toast.success(t("lab.rejectedOk"));
      setRejecting(null); setReason("");
      void qc.invalidateQueries({ queryKey: ["lab-worklist"] });
    } catch (e) { toast.error((e as EdgeError).message); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("lab.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("lab.hint")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48" aria-label={t("lab.statusLabel")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{t("lab.st.ordered")} + {t("lab.st.collected")}</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`lab.st.${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-36" aria-label={t("lab.priority")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("lab.priority")}: {t("lab.all")}</SelectItem>
            <SelectItem value="urgent">{t("lab.pr.urgent")}</SelectItem>
            <SelectItem value="routine">{t("lab.pr.routine")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-36" aria-label={t("lab.category")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("lab.category")}: {t("lab.all")}</SelectItem>
            <SelectItem value="lab">{t("lab.cat.lab")}</SelectItem>
            <SelectItem value="radiology">{t("lab.cat.radiology")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {q.isLoading ? <Skeleton className="h-40 w-full" /> : !rows.length ? (
        <EmptyState icon={FlaskConical} title={t("lab.empty")} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("lab.patient")}</TableHead><TableHead>{t("lab.test")}</TableHead><TableHead>{t("lab.priority")}</TableHead>
              <TableHead>{t("lab.orderedAt")}</TableHead><TableHead>{t("lab.statusLabel")}</TableHead><TableHead>{t("lab.barcode")}</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const urgent = r.priority === "urgent";
                return (
                  <TableRow key={r.id} className={cn(urgent && "bg-destructive/5")}>
                    <TableCell><div className="font-medium">{r.patients?.full_name}</div><Ltr className="text-xs text-muted-foreground">{r.patients?.mrn}</Ltr></TableCell>
                    <TableCell><Ltr>{r.lab_tests?.code}</Ltr> · <Ltr>{r.lab_tests?.name}</Ltr></TableCell>
                    <TableCell>{urgent ? <Badge variant="destructive">{t("lab.pr.urgent")}</Badge> : <span className="text-muted-foreground">{t("lab.pr.routine")}</span>}</TableCell>
                    <TableCell><Ltr>{fmt(r.created_at)}</Ltr></TableCell>
                    <TableCell>
                      <Badge variant={r.status === "rejected" ? "destructive" : r.status === "collected" ? "default" : "secondary"}>{t(`lab.st.${r.status}`, r.status)}</Badge>
                      {r.status === "rejected" && r.rejected_reason && <div className="mt-1 text-xs text-muted-foreground">{r.rejected_reason}</div>}
                    </TableCell>
                    <TableCell>{r.sample_barcode ? <Ltr>{r.sample_barcode}</Ltr> : "—"}</TableCell>
                    <TableCell className="space-x-2 text-end whitespace-nowrap">
                      {canAct && ["ordered", "rejected"].includes(r.status) && (
                        <Button size="sm" disabled={busy === r.id} onClick={() => void collect(r)}>{t("lab.collect")}</Button>
                      )}
                      {r.status === "collected" && r.sample_barcode && (
                        <Button size="sm" variant="outline" onClick={() => setLabel(r)}>{t("lab.reprint")}</Button>
                      )}
                      {canAct && r.status === "collected" && (
                        <Button size="sm" variant="ghost" onClick={() => { setRejecting(r); setReason(""); }}>{t("lab.reject")}</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {label && <SampleLabel row={label} onClose={() => setLabel(null)} />}

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("lab.rejectTitle")}</DialogTitle></DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("lab.rejectReason")} aria-label={t("lab.rejectReason")} />
          <DialogFooter>
            <Button variant="destructive" disabled={reason.trim().length < 3 || busy === rejecting?.id} onClick={() => void reject()}>{t("lab.rejectConfirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SampleLabel({ row, onClose }: { row: Row; onClose: () => void }) {
  const brand = usePrintBrand();
  return (
    <PrintPreviewPanel open onOpenChange={(o) => !o && onClose()} brand={brand}
      printLanguage={row.patients?.print_language === "ur" ? "ur" : null}
      job={{ documentType: "sample_label", documentId: row.sample_barcode ?? row.id, patientId: row.patient_id }}>
      {(pt) => (
        <div className="space-y-1">
          <p className="text-center font-bold uppercase">{pt("lab.label.title")}</p>
          <Barcode value={row.sample_barcode ?? ""} />
          <div className="grid grid-cols-2 gap-x-2 text-sm">
            <span>{pt("lab.patient")}</span><span className="text-end">{row.patients?.full_name}</span>
            <span>{pt("lab.label.mrn")}</span><span className="text-end"><Ltr>{row.patients?.mrn}</Ltr></span>
            <span>{pt("lab.label.test")}</span><span className="text-end"><Ltr>{row.lab_tests?.code} {row.lab_tests?.name}</Ltr></span>
            {row.lab_tests?.sample_type && <><span>{pt("lab.label.sample")}</span><span className="text-end"><Ltr>{row.lab_tests.sample_type}</Ltr></span></>}
            {row.collected_at && <><span>{pt("lab.label.collected")}</span><span className="text-end"><Ltr>{fmt(row.collected_at)}</Ltr></span></>}
          </div>
        </div>
      )}
    </PrintPreviewPanel>
  );
}
