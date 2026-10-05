import { useTranslation } from "react-i18next";
import { Ltr } from "@/components/mc/ltr";
import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { FLAG_CLASS, type LabValue } from "@/lib/lab";
import { cn } from "@/lib/utils";

/** Compact table of result values with flag colours (patient Lab tab, consultation, worklist). */
export function ResultValues({ values }: { values: LabValue[] }) {
  const { t } = useTranslation();
  if (!values.length) return null;
  return (
    <table className="w-full text-xs">
      <tbody>
        {values.map((v) => (
          <tr key={`${v.sort}-${v.parameter}`} className={cn(v.flag === "critical" && "bg-destructive/10")}>
            <td className="py-0.5 pe-2"><Ltr>{v.parameter}</Ltr></td>
            <td className={cn("py-0.5 pe-2", FLAG_CLASS[v.flag])}><Ltr>{v.value}{v.unit ? ` ${v.unit}` : ""}</Ltr></td>
            <td className="py-0.5 pe-2 text-muted-foreground"><Ltr>{v.reference_range ?? ""}</Ltr></td>
            <td className={cn("py-0.5", FLAG_CLASS[v.flag])}>{v.flag !== "normal" && t(`lab.flag.${v.flag}`)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface ReportOrder {
  id: string; status: string; patient_id: string; collected_at?: string | null; verified_at: string | null; has_critical: boolean;
  test: { code: string; name: string; sample_type?: string | null } | null;
  patient: { full_name: string; mrn: string; print_language: string | null } | null;
  values: LabValue[];
}
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Printable bilingual lab report (A4 by default) with flags. */
export function LabReport({ order, onClose }: { order: ReportOrder; onClose: () => void }) {
  const brand = usePrintBrand();
  return (
    <PrintPreviewPanel open onOpenChange={(o) => !o && onClose()} brand={brand} paper="a4"
      printLanguage={order.patient?.print_language === "ur" ? "ur" : null}
      job={{ documentType: "lab_report", documentId: order.id, patientId: order.patient_id }}>
      {(pt) => (
        <div className="space-y-2">
          <p className="text-center font-bold uppercase">{pt("lab.rpt.title")}</p>
          {order.status !== "verified" && <p className="text-center font-bold">{pt("lab.rpt.unverified")}</p>}
          <div className="grid grid-cols-2 gap-x-4 text-sm">
            <span>{pt("lab.rpt.patient")}: {order.patient?.full_name}</span>
            <span>{pt("lab.rpt.mrn")}: <Ltr>{order.patient?.mrn}</Ltr></span>
            <span>{pt("lab.rpt.test")}: <Ltr>{order.test?.code} {order.test?.name}</Ltr></span>
            {order.test?.sample_type && <span>{pt("lab.rpt.sample")}: <Ltr>{order.test.sample_type}</Ltr></span>}
            {order.collected_at && <span>{pt("lab.rpt.collected")}: <Ltr>{when(order.collected_at)}</Ltr></span>}
            {order.verified_at && <span>{pt("lab.rpt.verified")}: <Ltr>{when(order.verified_at)}</Ltr></span>}
          </div>
          <table className="mc-rule w-full border-t text-sm">
            <thead><tr className="text-start">
              <th className="py-1 text-start">{pt("lab.rpt.parameter")}</th><th className="text-start">{pt("lab.rpt.result")}</th>
              <th className="text-start">{pt("lab.rpt.range")}</th><th className="text-start">{pt("lab.rpt.flag")}</th>
            </tr></thead>
            <tbody>
              {order.values.map((v) => (
                <tr key={`${v.sort}-${v.parameter}`} className="border-t">
                  <td className="py-1"><Ltr>{v.parameter}</Ltr></td>
                  <td className={v.flag !== "normal" ? "font-bold" : ""}><Ltr>{v.value}{v.unit ? ` ${v.unit}` : ""}</Ltr></td>
                  <td><Ltr>{v.reference_range ?? ""}</Ltr></td>
                  <td className={v.flag === "critical" ? "font-bold uppercase" : ""}>{v.flag === "normal" ? "" : pt(`lab.flag.${v.flag}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {order.has_critical && <p className="mc-rule border-t pt-1 font-bold">{pt("lab.rpt.critical")}</p>}
        </div>
      )}
    </PrintPreviewPanel>
  );
}
