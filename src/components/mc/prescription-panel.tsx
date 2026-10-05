import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertOctagon, AlertTriangle, Pill, Printer, Search, Trash2 } from "lucide-react";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ltr } from "@/components/mc/ltr";
import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { useMedicines, type Medicine } from "@/lib/formulary";
import { usePatient, ageFrom } from "@/lib/patients";
import { useDepartmentsData } from "@/lib/departments-data";
import {
  DURATIONS, FREQUENCIES, INSTRUCTIONS, autoQuantity, useVisitPrescription, type RxItem, type RxWarning,
} from "@/lib/prescriptions";
import { cn } from "@/lib/utils";
import type { Visit } from "@/lib/visits";

const medLabel = (m: Medicine) => [m.generic_name, m.brand_name ? `(${m.brand_name})` : "", m.strength ?? ""].filter(Boolean).join(" ");
const isRed = (w: RxWarning) => w.severity === "contraindicated" || w.severity === "major";

export function PrescriptionPanel({ visit, canEdit }: { visit: Visit; canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const saved = useVisitPrescription(visit.id);
  const meds = useMedicines();
  const [items, setItems] = useState<RxItem[]>([]);
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [warnings, setWarnings] = useState<RxWarning[]>([]);
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (dirty || saved.data === undefined) return;
    setItems(saved.data?.items ?? []);
    setNotes(saved.data?.notes ?? "");
  }, [saved.data, dirty]);

  // Re-check safety whenever the medicine list changes.
  const idsKey = items.map((i) => i.medicine_id).join(",");
  useEffect(() => {
    setAck(false);
    if (!idsKey) { setWarnings([]); return; }
    const h = setTimeout(() => {
      callEdgeFunction<RxWarning[]>("check-prescription-safety", { patient_id: visit.patient_id, medicine_ids: idsKey.split(",") })
        .then(setWarnings).catch(() => setWarnings([]));
    }, 300);
    return () => clearTimeout(h);
  }, [idsKey, visit.patient_id]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return (meds.data ?? []).filter((m) => m.is_active && `${m.generic_name} ${m.brand_name ?? ""}`.toLowerCase().includes(s)).slice(0, 15);
  }, [q, meds.data]);

  const change = (next: RxItem[]) => { setItems(next); setDirty(true); };
  const add = (m: Medicine) => {
    const it: RxItem = {
      medicine_id: m.id, medicine_name: medLabel(m), form: m.form, dose: "1", frequency: "1+0+1", route: m.route,
      duration_days: 5, instructions_en: INSTRUCTIONS[0].en, instructions_ur: INSTRUCTIONS[0].ur, quantity: 0,
    };
    it.quantity = autoQuantity(it.form, it.dose, it.frequency, it.duration_days);
    change([...items, it]);
    setQ(""); setOpen(false);
  };
  const patch = (idx: number, p: Partial<RxItem>, recalc = true) => change(items.map((it, i) => {
    if (i !== idx) return it;
    const n = { ...it, ...p };
    if (recalc) n.quantity = autoQuantity(n.form, n.dose, n.frequency, n.duration_days);
    return n;
  }));

  const save = async () => {
    setSaving(true);
    try {
      await callEdgeFunction("save-prescription", { visit_id: visit.id, notes, acknowledged: ack, items });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["prescription", visit.id] });
      toast.success(t("rx.saved"));
    } catch (e) {
      const err = e as EdgeError & { warnings?: RxWarning[] };
      if (err.code === "needs_acknowledgement" && err.warnings) setWarnings(err.warnings);
      toast.error(err.message ?? t("errors.generic"));
    } finally { setSaving(false); }
  };

  const needsAck = warnings.length > 0;
  const hasSaved = !!saved.data && saved.data.items.length > 0;

  return (
    <section className="rounded-lg border bg-card p-4 text-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Pill className="size-4" />{t("consult.prescription")}</h2>
        {hasSaved && !dirty && <Button size="sm" variant="outline" onClick={() => setPrinting(true)}><Printer className="size-4" />{t("rx.print")}</Button>}
      </div>

      {canEdit && (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="ps-8" role="combobox" aria-expanded={open} aria-label={t("rx.searchPh")} placeholder={t("rx.searchPh")} value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { e.preventDefault(); add(hits[0]); } }} />
          {open && q.trim().length >= 2 && (
            <ul role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
              {hits.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">{t("rx.noMatch")}</li>}
              {hits.map((m) => (
                <li key={m.id} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); add(m); }}
                  className="flex cursor-pointer justify-between gap-2 rounded px-2 py-1.5 hover:bg-accent">
                  <Ltr className="text-start">{medLabel(m)}</Ltr>
                  <span className="shrink-0 text-xs text-muted-foreground">{t(`fm.forms.${m.form}`, { defaultValue: m.form })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {warnings.map((w, i) => (
            <li key={i} className={cn("flex gap-2 rounded-md px-2.5 py-2", isRed(w) ? "bg-urgent-soft text-urgent-fg" : "bg-warning-soft text-warning-fg")}>
              {isRed(w) ? <AlertOctagon className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
              <span><strong>{t(`rx.kind.${w.kind}`)}</strong> · <Ltr>{w.message}</Ltr></span>
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 ? <p className="text-muted-foreground">{t("rx.empty")}</p> : (
        <ol className="space-y-3">
          {items.map((it, idx) => {
            const flagged = warnings.filter((w) => w.medicine_ids.includes(it.medicine_id));
            return (
              <li key={`${it.medicine_id}-${idx}`} className={cn("rounded-md border p-3", flagged.some(isRed) ? "border-urgent" : flagged.length ? "border-warning" : "")}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Ltr className="font-medium">{idx + 1}. {it.medicine_name}</Ltr>
                  {canEdit && <Button size="icon" variant="ghost" className="size-7" aria-label={t("dx.remove")} onClick={() => change(items.filter((_, i) => i !== idx))}><Trash2 className="size-4" /></Button>}
                </div>
                {canEdit ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label className="text-xs">{t("rx.dose")}</Label>
                      <Input dir="ltr" value={it.dose} onChange={(e) => patch(idx, { dose: e.target.value })} maxLength={60} /></div>
                    <div className="space-y-1"><Label className="text-xs">{t("rx.frequency")}</Label>
                      <Select value={it.frequency} onValueChange={(v) => patch(idx, { frequency: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f.id} value={f.id}><Ltr>{f.id}</Ltr> · {t(`rx.freq.${f.id}`)}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-1"><Label className="text-xs">{t("rx.duration")}</Label>
                      <div className="flex gap-1">
                        <Input dir="ltr" inputMode="numeric" className="w-16" value={it.duration_days ?? ""} onChange={(e) => patch(idx, { duration_days: e.target.value ? Math.max(0, parseInt(e.target.value) || 0) : null })} />
                        <Select value="" onValueChange={(v) => patch(idx, { duration_days: Number(v) })}><SelectTrigger className="flex-1"><SelectValue placeholder={t("rx.days")} /></SelectTrigger>
                          <SelectContent>{DURATIONS.map((d) => <SelectItem key={d} value={String(d)}>{t("rx.nDays", { count: d })}</SelectItem>)}</SelectContent></Select>
                      </div></div>
                    <div className="space-y-1"><Label className="text-xs">{t("rx.quantity")}</Label>
                      <Input dir="ltr" inputMode="numeric" value={it.quantity} onChange={(e) => patch(idx, { quantity: Math.max(0, parseInt(e.target.value) || 0) }, false)} /></div>
                    <div className="col-span-2 space-y-1"><Label className="text-xs">{t("rx.instructions")}</Label>
                      <div className="flex flex-wrap gap-1">
                        {INSTRUCTIONS.map((p) => (
                          <button key={p.id} type="button" onClick={() => patch(idx, { instructions_en: p.en, instructions_ur: p.ur }, false)}
                            className={cn("rounded-full border px-2 py-0.5 text-xs", it.instructions_en === p.en ? "border-primary bg-primary/10" : "bg-muted")}>{t(`rx.ins.${p.id}`)}</button>
                        ))}
                      </div>
                      <Input dir="ltr" value={it.instructions_en} placeholder="English" onChange={(e) => patch(idx, { instructions_en: e.target.value }, false)} maxLength={300} />
                      <Input dir="rtl" lang="ur" value={it.instructions_ur} placeholder="اردو" onChange={(e) => patch(idx, { instructions_ur: e.target.value }, false)} maxLength={300} />
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground"><Ltr>{it.dose} · {it.frequency} · {it.duration_days ?? "—"}d · #{it.quantity}</Ltr> · {it.instructions_en}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {canEdit && items.length > 0 && (
        <div className="mt-3 space-y-3">
          <div className="space-y-1"><Label className="text-xs">{t("rx.notes")}</Label>
            <Textarea dir="auto" rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} maxLength={2000} /></div>
          {needsAck && (
            <label className="flex items-start gap-2 rounded-md border border-warning p-2.5">
              <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
              <span className="font-medium">{t("rx.ack")}</span>
            </label>
          )}
          {dirty && (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDirty(false)}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={save} disabled={saving || (needsAck && !ack)}>{t("rx.save")}</Button>
            </div>
          )}
        </div>
      )}
      {!canEdit && saved.data?.warnings_acknowledged && <p className="mt-2 text-xs text-muted-foreground">{t("rx.ackDone")}</p>}

      {printing && saved.data && <PrescriptionPrint visit={visit} open={printing} onOpenChange={setPrinting} />}
    </section>
  );
}

function PrescriptionPrint({ visit, open, onOpenChange }: { visit: Visit; open: boolean; onOpenChange: (o: boolean) => void }) {
  const brand = usePrintBrand();
  const rx = useVisitPrescription(visit.id).data;
  const patient = usePatient(visit.patient_id).data;
  const { doctors, people } = useDepartmentsData();
  const doc = (doctors.data ?? []).find((d) => d.id === visit.doctor_id);
  const docName = (doc && people.data?.find((p) => p.id === doc.user_id)?.full_name) || "";
  if (!rx || !patient) return null;
  const d = new Date(rx.updated_at);
  const when = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const age = ageFrom(patient.dob);
  return (
    <PrintPreviewPanel open={open} onOpenChange={onOpenChange} brand={brand} paper="a4" showSignature
      printLanguage={patient.print_language === "ur" ? "ur" : null} qrValue={patient.mrn}
      job={{ documentType: "prescription", documentId: rx.id, patientId: patient.id }}>
      {(pt, lng) => (
        <div className="space-y-2">
          <p className="text-center text-base font-bold">{pt("rx.printTitle")}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span>{pt("print.slip.name")}: {patient.full_name}</span>
            <span className="text-end">{pt("print.slip.date")}: <Ltr>{when}</Ltr></span>
            <span>MRN: <Ltr>{patient.mrn}</Ltr></span>
            <span className="text-end">{age !== null && <>{pt("print.slip.age")}: <Ltr>{age}</Ltr></>}</span>
          </div>
          {patient.allergies.length > 0 && <p className="font-semibold">{pt("print.slip.allergies")}: <Ltr>{patient.allergies.join(", ")}</Ltr></p>}
          <p className="mc-rule border-t pt-1 text-lg font-bold"><Ltr>℞</Ltr></p>
          <table className="w-full border-collapse">
            <thead><tr className="mc-rule border-b text-start">
              <th className="py-1 text-start">#</th><th className="py-1 text-start">{pt("rx.medicine")}</th><th className="py-1 text-start">{pt("rx.dose")}</th>
              <th className="py-1 text-start">{pt("rx.frequency")}</th><th className="py-1 text-start">{pt("rx.duration")}</th><th className="py-1 text-end">{pt("rx.quantity")}</th>
            </tr></thead>
            <tbody>
              {rx.items.map((it, i) => (
                <tr key={it.id} className="mc-rule border-b align-top">
                  <td className="py-1"><Ltr>{i + 1}</Ltr></td>
                  <td className="py-1"><Ltr className="font-semibold">{it.medicine_name}</Ltr>
                    <div className="text-xs">{lng === "ur" ? (it.instructions_ur || it.instructions_en) : it.instructions_en}</div></td>
                  <td className="py-1"><Ltr>{it.dose}</Ltr></td>
                  <td className="py-1"><Ltr>{it.frequency}</Ltr></td>
                  <td className="py-1">{it.duration_days ? pt("rx.nDays", { count: it.duration_days }) : "—"}</td>
                  <td className="py-1 text-end"><Ltr>{it.quantity}</Ltr></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rx.notes && <p dir="auto">{pt("rx.notes")}: {rx.notes}</p>}
          <div className="pt-2 text-end">
            <p className="font-semibold">{docName}</p>
            {doc?.specialty && <p className="text-xs">{doc.specialty}</p>}
            {doc?.pmdc_no && <p className="text-xs">{pt("rx.pmdc")}: <Ltr>{doc.pmdc_no}</Ltr></p>}
          </div>
        </div>
      )}
    </PrintPreviewPanel>
  );
}
