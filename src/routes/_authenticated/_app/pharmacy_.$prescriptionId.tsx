import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Printer } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Ltr } from "@/components/mc/ltr";
import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { daysToExpiry, useRxRealtime, type DispensedLine, type PreviewItem } from "@/lib/dispensing";

export const Route = createFileRoute("/_authenticated/_app/pharmacy_/$prescriptionId")({
  head: () => ({ meta: [
    { title: "Dispense prescription — MediCore HMS" },
    { name: "description", content: "Dispense medicines first-expiry-first-out and add them to the bill." },
    { property: "og:title", content: "Dispense prescription — MediCore HMS" },
    { property: "og:description", content: "Dispense medicines first-expiry-first-out and add them to the bill." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("pharmacy")}>
      <DispensePage />
    </RequireRole>
  ),
});

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
type Pick = { qty: string; sub: string; reason: string };

function DispensePage() {
  const { t } = useTranslation();
  const { prescriptionId } = Route.useParams();
  const { context } = useMyContext();
  useRxRealtime(context?.hospital?.id);
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ["rx-preview", prescriptionId],
    queryFn: () => callEdgeFunction<{ prescription: { id: string; patient_id: string; status: string; warnings: { message?: string }[] | null }; items: PreviewItem[] }>(
      "dispense-prescription", { prescription_id: prescriptionId, preview: true }),
  });
  const patient = useQuery({
    queryKey: ["rx-patient", preview.data?.prescription.patient_id],
    enabled: !!preview.data,
    queryFn: async () => (await supabase.from("patients").select("id, full_name, mrn, print_language").eq("id", preview.data!.prescription.patient_id).maybeSingle()).data,
  });
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busy, setBusy] = useState(false);
  const [labels, setLabels] = useState<{ lines: DispensedLine[]; items: PreviewItem[] } | null>(null);

  useEffect(() => {
    if (!preview.data) return;
    setPicks((old) => Object.fromEntries(preview.data.items.map((i) => [i.item_id, old[i.item_id] ?? { qty: String(Math.min(i.remaining, i.stock)), sub: "", reason: "" }])));
  }, [preview.data]);

  if (preview.isLoading) return <Skeleton className="h-64 w-full" />;
  if (preview.error || !preview.data) return <p className="text-destructive">{(preview.error as EdgeError | null)?.message ?? "Error"}</p>;
  const { prescription: rx, items } = preview.data;
  const set = (id: string, p: Partial<Pick>) => setPicks((s) => ({ ...s, [id]: { qty: "0", sub: "", reason: "", ...s[id], ...p } }));
  const open = items.filter((i) => i.remaining > 0);

  const submit = async () => {
    setBusy(true);
    try {
      const body = { prescription_id: rx.id, items: open.map((i) => ({ item_id: i.item_id, qty: Number(picks[i.item_id]?.qty || 0),
        substitute_medicine_id: picks[i.item_id]?.sub || undefined, substitution_reason: picks[i.item_id]?.reason || undefined })).filter((x) => x.qty > 0) };
      const res = await callEdgeFunction<{ status: string; lines: DispensedLine[] }>("dispense-prescription", body);
      const total = res.lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
      toast.success(t("rx.done", { amount: rs(total) }));
      setLabels({ lines: res.lines, items });
      setPicks({});
      void qc.invalidateQueries({ queryKey: ["rx-preview", prescriptionId] });
      void qc.invalidateQueries({ queryKey: ["rx-queue"] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e) { toast.error((e as EdgeError).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm"><Link to="/pharmacy"><ArrowLeft className="me-1 size-4 rtl:rotate-180" />{t("rx.back")}</Link></Button>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{patient.data?.full_name ?? "…"}</h1>
          <p className="text-sm text-muted-foreground"><Ltr>{patient.data?.mrn}</Ltr> · {t(`rx.st_${rx.status}`)}</p>
        </div>
        {labels && <Button variant="outline" onClick={() => setLabels({ ...labels })}><Printer className="me-1 size-4" />{t("rx.printLabels")}</Button>}
      </div>

      {Array.isArray(rx.warnings) && rx.warnings.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="mb-1 flex items-center gap-1 font-medium"><AlertTriangle className="size-4" />{t("rx.doctorWarnings")}</p>
          <ul className="list-disc ps-5">{rx.warnings.map((w, i) => <li key={i}>{w.message ?? JSON.stringify(w)}</li>)}</ul>
        </div>
      )}

      {open.length === 0 && <p className="rounded-lg border bg-card p-4 text-sm">{t("rx.allGiven")}</p>}

      <div className="space-y-3">
        {items.map((i) => {
          const p = picks[i.item_id] ?? { qty: "0", sub: "", reason: "" };
          return (
            <div key={i.item_id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium"><Ltr>{i.medicine_name}</Ltr></p>
                  <p className="text-sm text-muted-foreground"><Ltr>{[i.dose, i.frequency, i.route, i.duration_days ? `${i.duration_days}d` : ""].filter(Boolean).join(" · ")}</Ltr></p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {i.warnings.map((w) => <Badge key={w} variant={w === "expiring_soon" ? "outline" : "destructive"}>{t(`rx.w_${w}`)}</Badge>)}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                <span>{t("rx.prescribed")}: <Ltr>{i.quantity}</Ltr></span>
                <span>{t("rx.given")}: <Ltr>{i.dispensed}</Ltr></span>
                <span>{t("rx.left")}: <Ltr>{i.remaining}</Ltr></span>
                <span>{t("rx.stock")}: <Ltr>{i.stock}</Ltr></span>
                <span><Ltr>{rs(i.unit_price)}</Ltr></span>
              </div>
              {i.remaining > 0 && (
                <>
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{t("rx.batches")}</p>
                    {i.suggested.length === 0 ? <p className="text-sm text-destructive">{t("rx.noBatch")}</p> : (
                      <div className="flex flex-wrap gap-2">
                        {i.suggested.map((b) => {
                          const d = daysToExpiry(b.expiry_date);
                          return (
                            <span key={b.batch_id} className={`rounded border px-2 py-1 text-xs ${d <= 30 ? "border-destructive/50 bg-destructive/10" : d <= 90 ? "border-warning/50 bg-warning/10" : ""}`}>
                              <Ltr>{b.batch_no} · exp {b.expiry_date} · {b.qty}/{b.on_hand}</Ltr>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div><Label>{t("rx.dispenseQty")}</Label>
                      <Input type="number" min={0} max={i.remaining} value={p.qty} onChange={(e) => set(i.item_id, { qty: e.target.value })} /></div>
                    {i.alternatives.length > 0 && (
                      <div><Label>{t("rx.substitute")}</Label>
                        <Select value={p.sub || "none"} onValueChange={(v) => set(i.item_id, { sub: v === "none" ? "" : v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t("rx.noSub")}</SelectItem>
                            {i.alternatives.map((a) => <SelectItem key={a.id} value={a.id}><Ltr>{a.name} ({a.stock})</Ltr></SelectItem>)}
                          </SelectContent>
                        </Select></div>
                    )}
                    {p.sub && <div><Label>{t("rx.subReason")}</Label><Input value={p.reason} onChange={(e) => set(i.item_id, { reason: e.target.value })} /></div>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      {open.length > 0 && <Button onClick={submit} disabled={busy}>{t("rx.dispense")}</Button>}

      {labels && patient.data && <MedicineLabels lines={labels.lines} items={labels.items} patient={patient.data} onClose={() => setLabels(null)} />}
    </div>
  );
}

function MedicineLabels({ lines, items, patient, onClose }: { lines: DispensedLine[]; items: PreviewItem[]; patient: { id: string; full_name: string; mrn: string; print_language: string | null }; onClose: () => void }) {
  const brand = usePrintBrand();
  const byItem = new Map(items.map((i) => [i.item_id, i]));
  const today = new Date().toLocaleDateString("en-GB");
  return (
    <PrintPreviewPanel open onOpenChange={(o) => { if (!o) onClose(); }} brand={brand} paper="thermal80"
      printLanguage={patient.print_language === "ur" ? "ur" : null}
      job={{ documentType: "medicine_label", documentId: lines[0]?.id ?? "label", patientId: patient.id }}>
      {(pt, lng) => (
        <div className="space-y-3">
          {lines.map((l) => {
            const it = byItem.get(l.item_id);
            const how = lng === "en" ? it?.instructions_en : it?.instructions_ur || it?.instructions_en;
            return (
              <div key={l.id} className="mc-rule space-y-0.5 border-b pb-2">
                <p className="text-center font-bold uppercase">{pt("rx.label.title")}</p>
                <p className="text-base font-bold"><Ltr>{l.medicine_name}</Ltr></p>
                <div className="grid grid-cols-2 gap-x-2">
                  <span>{pt("rx.label.patient")}</span><span className="text-end">{patient.full_name}</span>
                  <span>{pt("rx.label.mrn")}</span><span className="text-end"><Ltr>{patient.mrn}</Ltr></span>
                  <span>{pt("rx.label.dose")}</span><span className="text-end"><Ltr>{[it?.dose, it?.frequency].filter(Boolean).join(" · ")}</Ltr></span>
                  {it?.duration_days ? <><span>{pt("rx.label.days")}</span><span className="text-end"><Ltr>{it.duration_days}</Ltr></span></> : null}
                  <span>{pt("rx.label.qty")}</span><span className="text-end"><Ltr>{l.qty}</Ltr></span>
                  <span>{pt("rx.label.batch")}</span><span className="text-end"><Ltr>{l.batch_no}</Ltr></span>
                  <span>{pt("rx.label.exp")}</span><span className="text-end"><Ltr>{l.expiry_date}</Ltr></span>
                  <span>{pt("rx.label.date")}</span><span className="text-end"><Ltr>{today}</Ltr></span>
                </div>
                {how && <p><span className="font-medium">{pt("rx.label.take")}:</span> {how}</p>}
              </div>
            );
          })}
        </div>
      )}
    </PrintPreviewPanel>
  );
}
