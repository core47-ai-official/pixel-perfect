import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { Ltr } from "@/components/mc/ltr";

export interface ReceiptData {
  kind: "payment" | "deposit" | "refund" | "deposit_applied";
  receipt_no: string;
  amount: number;
  tendered?: number | null;
  change?: number | null;
  balance?: number | null;
  invoice_no?: string | null;
  reason?: string | null;
  patient: { id: string; full_name: string; mrn: string; print_language: string | null };
  at: string;
}

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Bilingual 80mm cash receipt (English, then the patient's print language). */
export function CashReceipt({ data, open, onOpenChange }: { data: ReceiptData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const brand = usePrintBrand();
  const d = new Date(data.at);
  const when = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return (
    <PrintPreviewPanel
      open={open}
      onOpenChange={onOpenChange}
      brand={brand}
      paper="thermal80"
      printLanguage={data.patient.print_language === "ur" ? "ur" : null}
      qrValue={data.receipt_no}
      job={{ documentType: `receipt_${data.kind}`, documentId: data.receipt_no, patientId: data.patient.id }}
    >
      {(pt) => (
        <div className="space-y-2">
          <p className="text-center font-bold uppercase">{pt(`cash.print.title.${data.kind}`)}</p>
          <p className="text-center text-lg font-bold"><Ltr>{data.receipt_no}</Ltr></p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            <span>{pt("cash.print.date")}</span><span className="text-end"><Ltr>{when}</Ltr></span>
            <span>{pt("cash.print.patient")}</span><span className="text-end">{data.patient.full_name}</span>
            <span>{pt("cash.print.mrn")}</span><span className="text-end"><Ltr>{data.patient.mrn}</Ltr></span>
            {data.invoice_no && <><span>{pt("cash.print.bill")}</span><span className="text-end"><Ltr>{data.invoice_no}</Ltr></span></>}
            <span>{pt("cash.print.mode")}</span><span className="text-end">{pt("cash.print.cash")}</span>
          </div>
          <div className="mc-rule grid grid-cols-2 gap-x-2 border-t pt-1 text-base font-bold">
            <span>{pt("cash.print.amount")}</span><span className="text-end"><Ltr>{rs(Math.abs(data.amount))}</Ltr></span>
          </div>
          {data.tendered != null && data.kind !== "refund" && (
            <div className="grid grid-cols-2 gap-x-2">
              <span>{pt("cash.print.tendered")}</span><span className="text-end"><Ltr>{rs(data.tendered)}</Ltr></span>
              <span>{pt("cash.print.change")}</span><span className="text-end"><Ltr>{rs(data.change ?? 0)}</Ltr></span>
            </div>
          )}
          {data.balance != null && (
            <div className="grid grid-cols-2 gap-x-2">
              <span>{pt("cash.print.balance")}</span><span className="text-end"><Ltr>{rs(data.balance)}</Ltr></span>
            </div>
          )}
          {data.reason && <p>{pt("cash.print.reason")}: {data.reason}</p>}
          <p className="mc-rule border-t pt-1 text-center text-xs">{pt("cash.print.thanks")}</p>
        </div>
      )}
    </PrintPreviewPanel>
  );
}
