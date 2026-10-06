import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, FlaskConical, Pill } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { LabReport, ResultValues } from "@/components/mc/lab-results";
import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { supabase } from "@/integrations/supabase/client";
import { usePatientOrders, type LabOrder } from "@/lib/lab";
import { pkDay, useMyPatient, type PortalPatient } from "@/lib/portal";
import { NotLinked } from "./book";

export const Route = createFileRoute("/_authenticated/portal/reports")({
  head: () => ({ meta: [{ title: "My reports — Patient portal" }, { name: "description", content: "Your verified lab reports and prescriptions." }] }),
  component: Reports,
});

interface RxRow {
  id: string; updated_at: string; notes: string | null;
  prescription_items: { id: string; medicine_name: string; dose: string | null; frequency: string | null; duration_days: number | null; quantity: number | null; instructions_en: string | null; instructions_ur: string | null; sort_order: number | null }[];
}

function Reports() {
  const { t } = useTranslation();
  const me = useMyPatient();
  if (me.isLoading) return <Skeleton className="h-40 rounded-patient" />;
  if (!me.data) return <NotLinked />;
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t("portal.nav.reports")}</h1>
      <Tabs defaultValue="lab">
        <TabsList className="grid w-full grid-cols-2 rounded-patient">
          <TabsTrigger value="lab"><FlaskConical className="size-4" aria-hidden />{t("portal.reports.lab")}</TabsTrigger>
          <TabsTrigger value="rx"><Pill className="size-4" aria-hidden />{t("portal.reports.rx")}</TabsTrigger>
        </TabsList>
        <TabsContent value="lab" className="space-y-3 pt-2"><LabList patient={me.data} /></TabsContent>
        <TabsContent value="rx" className="space-y-3 pt-2"><RxList patient={me.data} /></TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">{t("portal.reports.pdfHint")}</p>
    </div>
  );
}

function LabList({ patient }: { patient: PortalPatient }) {
  const { t } = useTranslation();
  const q = usePatientOrders(patient.id);
  const [open, setOpen] = useState<LabOrder | null>(null);
  if (q.isLoading) return <Skeleton className="h-32 rounded-patient" />;
  const rows = (q.data ?? []).filter((o) => o.status === "verified");
  if (!rows.length) return <PCard><p className="text-muted-foreground">{t("portal.noReports")}</p></PCard>;
  return (
    <>
      {rows.map((o) => (
        <PCard key={o.id} className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Ltr className="font-medium">{o.test?.name ?? "—"}</Ltr>
            <span className="text-sm text-muted-foreground"><Ltr>{o.verified_at ? pkDay(o.verified_at) : ""}</Ltr></span>
          </div>
          {o.values.length > 0 ? <ResultValues values={o.values} /> : o.result ? <Ltr className="whitespace-pre-wrap text-sm">{o.result}</Ltr> : null}
          <Button variant="outline" className="w-full rounded-patient" onClick={() => setOpen(o)}><Download aria-hidden />{t("portal.reports.download")}</Button>
        </PCard>
      ))}
      {open && <LabReport onClose={() => setOpen(null)} order={{ ...open, patient: { full_name: patient.full_name, mrn: patient.mrn, print_language: patient.print_language } }} />}
    </>
  );
}

function RxList({ patient }: { patient: PortalPatient }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<RxRow | null>(null);
  const q = useQuery({
    queryKey: ["portal", "prescriptions", patient.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("prescriptions")
        .select("id, updated_at, notes, prescription_items(id, medicine_name, dose, frequency, duration_days, quantity, instructions_en, instructions_ur, sort_order)")
        .eq("patient_id", patient.id).neq("status", "draft").order("updated_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as RxRow[];
    },
  });
  if (q.isLoading) return <Skeleton className="h-32 rounded-patient" />;
  const rows = (q.data ?? []).filter((r) => r.prescription_items.length);
  if (!rows.length) return <PCard><p className="text-muted-foreground">{t("portal.reports.noRx")}</p></PCard>;
  return (
    <>
      {rows.map((r) => (
        <PCard key={r.id} className="space-y-2">
          <p className="text-sm text-muted-foreground"><Ltr>{pkDay(r.updated_at)}</Ltr></p>
          <ul className="space-y-1 text-sm">
            {r.prescription_items.map((it) => (
              <li key={it.id}><Ltr className="font-medium">{it.medicine_name}</Ltr> <Ltr className="text-muted-foreground">{[it.dose, it.frequency].filter(Boolean).join(" · ")}</Ltr></li>
            ))}
          </ul>
          <Button variant="outline" className="w-full rounded-patient" onClick={() => setOpen(r)}><Download aria-hidden />{t("portal.reports.download")}</Button>
        </PCard>
      ))}
      {open && <RxPrint rx={open} patient={patient} onClose={() => setOpen(null)} />}
    </>
  );
}

function RxPrint({ rx, patient, onClose }: { rx: RxRow; patient: PortalPatient; onClose: () => void }) {
  const brand = usePrintBrand();
  const items = [...rx.prescription_items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return (
    <PrintPreviewPanel open onOpenChange={(o) => !o && onClose()} brand={brand} paper="a4" qrValue={patient.mrn}
      printLanguage={patient.print_language === "ur" ? "ur" : null}
      job={{ documentType: "prescription", documentId: rx.id, patientId: patient.id }}>
      {(pt, lng) => (
        <div className="space-y-2">
          <p className="text-center text-base font-bold">{pt("rx.printTitle")}</p>
          <div className="grid grid-cols-2 gap-x-3">
            <span>{pt("print.slip.name")}: {patient.full_name}</span>
            <span className="text-end">{pt("print.slip.date")}: <Ltr>{pkDay(rx.updated_at)}</Ltr></span>
            <span>MRN: <Ltr>{patient.mrn}</Ltr></span>
          </div>
          <table className="mc-rule w-full border-t">
            <thead><tr className="text-start">
              <th className="py-1 text-start">#</th><th className="text-start">{pt("rx.medicine")}</th><th className="text-start">{pt("rx.dose")}</th>
              <th className="text-start">{pt("rx.frequency")}</th><th className="text-start">{pt("rx.duration")}</th><th className="text-end">{pt("rx.quantity")}</th>
            </tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id} className="mc-rule border-t align-top">
                  <td className="py-1"><Ltr>{i + 1}</Ltr></td>
                  <td className="py-1"><Ltr className="font-semibold">{it.medicine_name}</Ltr>
                    <div className="text-xs">{lng === "ur" ? (it.instructions_ur || it.instructions_en) : it.instructions_en}</div></td>
                  <td><Ltr>{it.dose}</Ltr></td><td><Ltr>{it.frequency}</Ltr></td>
                  <td>{it.duration_days ? pt("rx.nDays", { count: it.duration_days }) : "—"}</td>
                  <td className="text-end"><Ltr>{it.quantity}</Ltr></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rx.notes && <p dir="auto">{pt("rx.notes")}: {rx.notes}</p>}
        </div>
      )}
    </PrintPreviewPanel>
  );
}
