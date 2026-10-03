import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { QRCodeSVG } from "qrcode.react";
import { Printer } from "lucide-react";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/mc/ltr";
import { SidePanel } from "@/components/mc/side-panel";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { cn } from "@/lib/utils";

export type PrintPaper = "thermal80" | "a4";
export type PrintLanguage = "en" | "ur";
export type BilingualLayout = "stacked" | "side_by_side";

/** Everything the header/footer needs; normally comes from company settings via usePrintBrand(). */
export interface PrintBrand {
  name: string;
  address?: string;
  phone?: string;
  logoUrl?: string | null;
  monoLogoUrl?: string | null;
  signatureUrl?: string | null;
  stampUrl?: string | null;
  showLogo?: boolean;
  showQr?: boolean;
  headerText?: string;
  footerText?: string;
  layout?: BilingualLayout;
  defaultPaper?: PrintPaper;
}

/** Builds a PrintBrand from the hospital's company settings. */
export function usePrintBrand(): PrintBrand {
  const { values, raw } = useCompanySettings();
  const g = values.general, p = values.printing;
  const urls = raw?.asset_urls ?? {};
  const phone = raw?.contacts.find((c) => c.type === "phone" && c.is_primary)?.value ?? raw?.contacts.find((c) => c.type === "phone")?.value;
  return {
    name: String(g["hospital_name"] || ""),
    address: [g["address"], g["city"]].filter(Boolean).join(", "),
    phone,
    logoUrl: urls["logo"] ?? null,
    monoLogoUrl: urls["mono_logo"] ?? null,
    signatureUrl: urls["signature"] ?? null,
    stampUrl: urls["stamp"] ?? null,
    showLogo: Boolean(p["show_logo"]),
    showQr: Boolean(p["show_qr"]),
    headerText: String(p["header_text"] || ""),
    footerText: String(p["footer_text"] || ""),
    layout: (p["bilingual_layout"] as BilingualLayout) || "stacked",
    defaultPaper: p["receipt_paper"] === "thermal80" ? "thermal80" : "a4",
  };
}

export interface PrintDocumentProps {
  paper: PrintPaper;
  brand: PrintBrand;
  /** Patient's print language. English is always printed first; a second copy follows when this differs. */
  printLanguage?: PrintLanguage | null;
  /** Overrides brand.layout. */
  layout?: BilingualLayout;
  qrValue?: string;
  showSignature?: boolean;
  /** Rendered once per language with a translator fixed to that language. Wrap codes/numbers/drug names in <Ltr>. */
  children: (t: TFunction, lng: PrintLanguage) => ReactNode;
}

/** A printable page (80 mm thermal or A4) with the hospital header and bilingual body. */
export function PrintDocument({ paper, brand, printLanguage, layout, qrValue, showSignature, children }: PrintDocumentProps) {
  const langs: PrintLanguage[] = printLanguage && printLanguage !== "en" ? ["en", printLanguage] : ["en"];
  const mode = layout ?? brand.layout ?? "stacked";
  const sideBySide = mode === "side_by_side" && langs.length > 1 && paper === "a4";
  const logo = paper === "thermal80" ? brand.monoLogoUrl || brand.logoUrl : brand.logoUrl;
  const thermal = paper === "thermal80";

  return (
    <div className={cn("mc-paper", `mc-paper-${paper}`)} dir="ltr" lang="en">
      <header className={cn("mc-rule border-b pb-2", thermal ? "text-center" : "flex items-center gap-4")}>
        {brand.showLogo !== false && logo && (
          <img src={logo} alt="" className={cn("mc-print-logo object-contain", thermal ? "mx-auto mb-1 h-10" : "h-16 w-16")} />
        )}
        <div className={thermal ? "" : "flex-1"}>
          <p className={cn("font-bold", thermal ? "text-[13px]" : "text-xl")}>{brand.name || "—"}</p>
          {brand.address && <p className="mc-muted">{brand.address}</p>}
          {brand.phone && <p className="mc-muted">Phone: <Ltr>{brand.phone}</Ltr></p>}
          {brand.headerText && <p className="mc-muted whitespace-pre-line">{brand.headerText}</p>}
        </div>
        {!thermal && brand.showQr !== false && qrValue && <QRCodeSVG value={qrValue} size={72} />}
      </header>

      <div className={cn(sideBySide ? "grid grid-cols-2 gap-6" : "space-y-3", "pt-2")}>
        {langs.map((lng, i) => (
          <section
            key={lng}
            lang={lng}
            dir={lng === "ur" ? "rtl" : "ltr"}
            className={cn(i > 0 && !sideBySide && "mc-rule border-t border-dashed pt-3", i > 0 && sideBySide && "mc-rule border-s ps-6")}
          >
            {children(i18n.getFixedT(lng), lng)}
          </section>
        ))}
      </div>

      {(showSignature || (thermal && brand.showQr !== false && qrValue) || brand.footerText) && (
        <footer className="mc-rule mt-3 border-t pt-2">
          {showSignature && (brand.signatureUrl || brand.stampUrl) && (
            <div className={cn("flex items-end gap-3", thermal ? "justify-center" : "justify-end")}>
              {brand.stampUrl && <img src={brand.stampUrl} alt="" className={thermal ? "h-12" : "h-20"} />}
              {brand.signatureUrl && (
                <div className="text-center">
                  <img src={brand.signatureUrl} alt="" className={thermal ? "h-8" : "h-12"} />
                  <p className="mc-muted mc-rule border-t text-[10px]">Authorised signature</p>
                </div>
              )}
            </div>
          )}
          {thermal && brand.showQr !== false && qrValue && (
            <div className="mt-2 flex justify-center"><QRCodeSVG value={qrValue} size={80} /></div>
          )}
          {brand.footerText && <p className="mc-muted mt-1 whitespace-pre-line text-center">{brand.footerText}</p>}
        </footer>
      )}
    </div>
  );
}

export interface PrintJobInfo {
  documentType: string;
  documentId?: string;
  patientId?: string;
}

/** Side panel with an on-screen preview, paper choice and a Print button that logs the job. */
export function PrintPreviewPanel({
  open,
  onOpenChange,
  title,
  job,
  paper: initialPaper = "thermal80",
  allowPaperChange = true,
  ...doc
}: Omit<PrintDocumentProps, "paper"> & {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title?: string;
  job: PrintJobInfo;
  paper?: PrintPaper;
  allowPaperChange?: boolean;
}) {
  const { t } = useTranslation();
  const [paper, setPaper] = useState<PrintPaper>(initialPaper);
  useEffect(() => { if (open) setPaper(initialPaper); }, [open, initialPaper]);

  // Page size for the browser's print dialog while the panel is open.
  useEffect(() => {
    if (!open) return;
    const style = document.createElement("style");
    style.textContent = paper === "thermal80" ? "@page { size: 80mm auto; margin: 0; }" : "@page { size: A4; margin: 0; }";
    document.head.appendChild(style);
    return () => style.remove();
  }, [open, paper]);

  const print = () => {
    window.print();
    const languages = doc.printLanguage && doc.printLanguage !== "en" ? ["en", doc.printLanguage] : ["en"];
    void callEdgeFunction("log-print-job", {
      document_type: job.documentType,
      document_id: job.documentId,
      patient_id: job.patientId,
      paper,
      languages,
      copies: 1,
    }).catch(() => { /* printing must never fail because logging did */ });
  };

  const document_ = <PrintDocument {...doc} paper={paper} />;

  return (
    <>
      <SidePanel
        open={open}
        onOpenChange={onOpenChange}
        title={title ?? t("print.preview")}
        footer={<Button onClick={print}><Printer /> {t("print.print")}</Button>}
      >
        {allowPaperChange && (
          <div className="mb-4 inline-flex rounded-staff border p-0.5">
            {(["thermal80", "a4"] as const).map((p) => (
              <Button key={p} size="sm" variant={paper === p ? "primary" : "ghost"} onClick={() => setPaper(p)}>
                {t(`print.${p}`)}
              </Button>
            ))}
          </div>
        )}
        <div className="flex justify-center overflow-hidden rounded-staff bg-muted p-3">
          <div className="shadow-card" style={paper === "a4" ? { zoom: 0.45 } : undefined}>{document_}</div>
        </div>
      </SidePanel>
      {open && typeof document !== "undefined" && createPortal(<div className="mc-print-root">{document_}</div>, document.body)}
    </>
  );
}
