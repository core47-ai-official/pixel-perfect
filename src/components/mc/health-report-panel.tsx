import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileText, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ltr } from "@/components/mc/ltr";
import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { HealthReportBody } from "@/components/mc/health-report";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { pkDay, pkTime } from "@/lib/portal";
import { lastDays, type HealthReport } from "@/lib/trends";

/** A4 preview of a report (patient download or doctor view of an attached snapshot). */
export function HealthReportPreview({ report, onClose, documentId }: { report: HealthReport; onClose: () => void; documentId?: string }) {
  const { t } = useTranslation();
  const brand = usePrintBrand();
  return (
    <PrintPreviewPanel open onOpenChange={(o) => !o && onClose()} brand={brand} paper="a4" allowPaperChange={false} title={t("hr.title")}
      printLanguage={report.patient?.print_language === "ur" ? "ur" : null} {...(report.patient?.mrn ? { qrValue: report.patient.mrn } : {})}
      job={{ documentType: "health_report", ...(documentId ? { documentId } : {}) }}>
      {(pt) => <HealthReportBody r={report} pt={pt} />}
    </PrintPreviewPanel>
  );
}

const PRESETS = [7, 30, 90] as const;

export function HealthReportButton() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(lastDays(30)[0]!);
  const [to, setTo] = useState(lastDays(1)[0]!);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [appt, setAppt] = useState("");
  const upcoming = useQuery({
    queryKey: ["upcoming-appts-for-report"], enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("appointments").select("id, slot_start, status, health_report_shares(id, date_from, date_to)")
        .gte("slot_start", new Date(Date.now() - 3600e3).toISOString()).in("status", ["booked", "waiting", "checked_in", "needs_rebooking"]).order("slot_start").limit(10);
      if (error) throw error;
      return data;
    },
  });
  const preset = (n: number) => { const d = lastDays(n); setFrom(d[0]!); setTo(d[d.length - 1]!); };
  const generate = async () => {
    setBusy(true);
    try { setReport(await callEdgeFunction<HealthReport>("generate-health-report", { from, to })); }
    catch (e) { toast.error((e as Error).message || t("hr.failed")); }
    finally { setBusy(false); }
  };
  const attach = async () => {
    setBusy(true);
    try {
      await callEdgeFunction("attach-report-to-appointment", { appointment_id: appt, from, to });
      toast.success(t("hr.attached"));
      await qc.invalidateQueries({ queryKey: ["upcoming-appts-for-report"] });
    } catch (e) { toast.error((e as Error).message || t("hr.failed")); }
    finally { setBusy(false); }
  };
  return (
    <>
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}><FileText className="size-4" />{t("hr.open")}</Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-patient">
          <SheetHeader><SheetTitle>{t("hr.title")}</SheetTitle></SheetHeader>
          <div className="space-y-4 p-4">
            <div className="flex gap-2">{PRESETS.map((n) => <Button key={n} size="sm" variant="outline" onClick={() => preset(n)}>{t("trd.days", { count: n })}</Button>)}</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label htmlFor="hr-f">{t("hr.from")}</Label><Input id="hr-f" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="hr-t">{t("hr.to")}</Label><Input id="hr-t" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            <Button className="w-full" size="lg" disabled={busy} onClick={generate}><FileText className="size-4" />{t("hr.generate")}</Button>
            <p className="text-xs text-muted-foreground">{t("hr.pdfHint")}</p>
            <div className="space-y-2 border-t pt-4">
              <Label>{t("hr.attachTo")}</Label>
              {upcoming.data?.length ? (
                <>
                  <Select value={appt} onValueChange={setAppt}>
                    <SelectTrigger><SelectValue placeholder={t("hr.pickAppt")} /></SelectTrigger>
                    <SelectContent>{upcoming.data.map((a) => (
                      <SelectItem key={a.id} value={a.id}><Ltr>{pkDay(a.slot_start)} {pkTime(a.slot_start)}</Ltr>{(a.health_report_shares as unknown[] | null)?.length ? ` · ${t("hr.alreadyAttached")}` : ""}</SelectItem>
                    ))}</SelectContent>
                  </Select>
                  <Button variant="outline" className="w-full" disabled={busy || !appt} onClick={attach}><Paperclip className="size-4" />{t("hr.attach")}</Button>
                  <p className="text-xs text-muted-foreground">{t("hr.attachNote")}</p>
                </>
              ) : <p className="text-sm text-muted-foreground">{t("portal.noNextAppt")}</p>}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      {report && <HealthReportPreview report={report} onClose={() => setReport(null)} />}
    </>
  );
}
