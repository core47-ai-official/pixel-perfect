import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, Printer, Trash2 } from "lucide-react";
import { SidePanel } from "@/components/mc/side-panel";
import { Ltr } from "@/components/mc/ltr";
import { ConfirmDialog } from "@/components/mc/confirm-dialog";
import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { callEdgeFunction, useEdgeFunction } from "@/hooks/use-edge-function";

export interface DsMedicine { name: string; dose: string | null; frequency: string | null; duration_days: number | null; instructions_en: string | null; instructions_ur: string | null }
export interface DischargeSummary {
  id: string; admission_id: string; patient_id: string; diagnosis: string | null; procedures: string | null; course: string | null;
  condition_at_discharge: string | null; medicines: DsMedicine[]; follow_up_date: string | null; advice_en: string | null; advice_ur: string | null;
  written_by: string | null; finalized_at: string | null;
}
export interface DsPatient { id: string; full_name: string; mrn?: string | null; print_language?: string | null }
export interface DsAdmission { id: string; admitted_at: string; discharged_at: string | null; status: string }

/** Loads (and for active stays, creates a prefilled draft of) the admission's discharge summary. */
export function useDischargeSummary(admissionId: string | null | undefined) {
  return useQuery({
    queryKey: ["discharge-summary", admissionId], enabled: !!admissionId,
    queryFn: () => callEdgeFunction<DischargeSummary | null>("draft-discharge-summary", { admission_id: admissionId }),
  });
}

const TEXT = ["diagnosis", "procedures", "course", "condition_at_discharge"] as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-PK", { dateStyle: "medium", timeZone: "Asia/Karachi" });

export function DischargeSummaryPanel({ admission, patient, canEdit, onClose }: { admission: DsAdmission; patient: DsPatient; canEdit: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useDischargeSummary(admission.id);
  const [f, setF] = useState<DischargeSummary | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [print, setPrint] = useState(false);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  const inv = [["discharge-summary", admission.id], ["discharge-summary"]];
  const save = useEdgeFunction<DischargeSummary>("draft-discharge-summary", { invalidate: inv, successMessage: t("ds.saved") });
  const fin = useEdgeFunction<DischargeSummary>("finalize-discharge-summary", { invalidate: inv, successMessage: t("ds.finalized") });
  const locked = !!f?.finalized_at || !canEdit;
  const body = () => f && ({ admission_id: admission.id, diagnosis: f.diagnosis, procedures: f.procedures, course: f.course, condition_at_discharge: f.condition_at_discharge,
    medicines: f.medicines, follow_up_date: f.follow_up_date || null, advice_en: f.advice_en, advice_ur: f.advice_ur });
  const doSave = async () => { try { const d = await save.mutateAsync(body()); qc.setQueryData(["discharge-summary", admission.id], d); } catch { /* shown */ } };
  const doFinal = async () => { try { await fin.mutateAsync(body()); setConfirm(false); } catch { setConfirm(false); } };
  const setMed = (i: number, k: keyof DsMedicine, v: string) => f && setF({ ...f, medicines: f.medicines.map((m, j) => j === i ? { ...m, [k]: k === "duration_days" ? (Number(v) || null) : v } : m) });

  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={`${t("ds.title")} · ${patient.full_name}`}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => setPrint(true)} disabled={!f}><Printer /> {t("ds.print")}</Button>
        {!locked && <Button variant="outline" onClick={doSave} disabled={save.isPending}>{t("ds.saveDraft")}</Button>}
        {!locked && <Button onClick={() => setConfirm(true)} disabled={fin.isPending || !f?.diagnosis || !f?.condition_at_discharge}><Lock /> {t("ds.finalize")}</Button>}
      </div>}>
      {q.isLoading || (!f && q.data) ? <Skeleton className="h-80" /> : !f ? <p className="text-sm text-muted-foreground">{t("ds.none")}</p> : (
        <div className="space-y-4">
          <p className="rounded-staff border bg-muted/50 p-2 text-xs">
            {f.finalized_at ? <><Lock className="inline size-3" /> {t("ds.lockedAt")} <Ltr>{day(f.finalized_at)}</Ltr></> : t("ds.draftHint")}
          </p>
          {TEXT.map((k) => (
            <div key={k} className="space-y-1.5"><Label htmlFor={`ds-${k}`}>{t(`ds.f.${k}`)}{(k === "diagnosis" || k === "condition_at_discharge") && " *"}</Label>
              <Textarea id={`ds-${k}`} rows={k === "course" ? 5 : 3} value={f[k] ?? ""} disabled={locked} maxLength={4000} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
          ))}
          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label>{t("ds.f.medicines")}</Label>
              {!locked && <Button size="sm" variant="ghost" onClick={() => setF({ ...f, medicines: [...f.medicines, { name: "", dose: "", frequency: "", duration_days: null, instructions_en: "", instructions_ur: "" }] })}><Plus /> {t("ds.addMed")}</Button>}</div>
            {f.medicines.length === 0 && <p className="text-xs text-muted-foreground">{t("ds.noMeds")}</p>}
            {f.medicines.map((m, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-staff border p-2 sm:grid-cols-4">
                <Input aria-label={t("ds.m.name")} placeholder={t("ds.m.name")} value={m.name} disabled={locked} onChange={(e) => setMed(i, "name", e.target.value)} className="col-span-2" dir="ltr" />
                <Input aria-label={t("ds.m.dose")} placeholder={t("ds.m.dose")} value={m.dose ?? ""} disabled={locked} onChange={(e) => setMed(i, "dose", e.target.value)} dir="ltr" />
                <Input aria-label={t("ds.m.frequency")} placeholder={t("ds.m.frequency")} value={m.frequency ?? ""} disabled={locked} onChange={(e) => setMed(i, "frequency", e.target.value)} dir="ltr" />
                <Input aria-label={t("ds.m.days")} placeholder={t("ds.m.days")} type="number" min={1} value={m.duration_days ?? ""} disabled={locked} onChange={(e) => setMed(i, "duration_days", e.target.value)} />
                <Input aria-label={t("ds.m.instrEn")} placeholder={t("ds.m.instrEn")} value={m.instructions_en ?? ""} disabled={locked} onChange={(e) => setMed(i, "instructions_en", e.target.value)} />
                <Input aria-label={t("ds.m.instrUr")} placeholder={t("ds.m.instrUr")} value={m.instructions_ur ?? ""} disabled={locked} onChange={(e) => setMed(i, "instructions_ur", e.target.value)} dir="rtl" lang="ur" />
                {!locked && <Button size="icon" variant="ghost" aria-label={t("ds.removeMed")} onClick={() => setF({ ...f, medicines: f.medicines.filter((_, j) => j !== i) })}><Trash2 /></Button>}
              </div>
            ))}
          </div>
          <div className="space-y-1.5"><Label htmlFor="ds-fu">{t("ds.f.follow_up_date")}</Label>
            <Input id="ds-fu" type="date" value={f.follow_up_date ?? ""} disabled={locked} onChange={(e) => setF({ ...f, follow_up_date: e.target.value || null })} className="max-w-48" />
            <p className="text-xs text-muted-foreground">{t("ds.fuHint")}</p></div>
          <div className="space-y-1.5"><Label htmlFor="ds-aen">{t("ds.f.advice_en")}</Label>
            <Textarea id="ds-aen" rows={3} value={f.advice_en ?? ""} disabled={locked} onChange={(e) => setF({ ...f, advice_en: e.target.value })} dir="ltr" /></div>
          <div className="space-y-1.5"><Label htmlFor="ds-aur">{t("ds.f.advice_ur")}</Label>
            <Textarea id="ds-aur" rows={3} value={f.advice_ur ?? ""} disabled={locked} onChange={(e) => setF({ ...f, advice_ur: e.target.value })} dir="rtl" lang="ur" /></div>
        </div>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={t("ds.finalizeTitle")} description={t("ds.finalizeBody")} confirmLabel={t("ds.finalize")} onConfirm={doFinal} />
      {print && f && <DischargeSummaryPrint summary={f} admission={admission} patient={patient} onClose={() => setPrint(false)} />}
    </SidePanel>
  );
}

export function DischargeSummaryPrint({ summary: s, admission, patient, onClose }: { summary: DischargeSummary; admission: DsAdmission; patient: DsPatient; onClose: () => void }) {
  const brand = usePrintBrand();
  const lines = (v: string | null) => (v ?? "").split("\n").filter(Boolean);
  return (
    <PrintPreviewPanel open onOpenChange={(o) => !o && onClose()} brand={brand} paper="a4" allowPaperChange={false} showSignature
      printLanguage={patient.print_language === "ur" ? "ur" : null}
      job={{ documentType: "discharge_summary", documentId: s.id, patientId: patient.id }}>
      {(pt, lng) => (
        <div className="space-y-3 text-sm">
          <p className="text-center text-base font-bold uppercase">{pt("ds.p.title")}</p>
          {!s.finalized_at && <p className="text-center font-bold">{pt("ds.p.draft")}</p>}
          <div className="grid grid-cols-2 gap-x-4">
            <span>{pt("ds.p.patient")}: {patient.full_name}</span>
            <span>{pt("ds.p.mrn")}: <Ltr>{patient.mrn}</Ltr></span>
            <span>{pt("ds.p.admitted")}: <Ltr>{day(admission.admitted_at)}</Ltr></span>
            <span>{pt("ds.p.discharged")}: <Ltr>{admission.discharged_at ? day(admission.discharged_at) : "—"}</Ltr></span>
          </div>
          {TEXT.map((k) => s[k] ? (
            <section key={k}><p className="mc-rule border-b font-semibold">{pt(`ds.f.${k}`)}</p>
              {lines(s[k]).map((l, i) => <p key={i} dir="ltr" className="text-start">{l}</p>)}</section>
          ) : null)}
          {s.medicines.length > 0 && (
            <section><p className="mc-rule border-b font-semibold">{pt("ds.f.medicines")}</p>
              <table className="w-full"><tbody>{s.medicines.map((m, i) => (
                <tr key={i} className="align-top"><td className="py-0.5"><Ltr className="font-semibold">{m.name}</Ltr></td>
                  <td><Ltr>{[m.dose, m.frequency, m.duration_days ? `${m.duration_days} d` : null].filter(Boolean).join(" · ")}</Ltr></td>
                  <td>{lng === "ur" ? (m.instructions_ur || m.instructions_en) : m.instructions_en}</td></tr>
              ))}</tbody></table></section>
          )}
          {s.follow_up_date && <p><span className="font-semibold">{pt("ds.f.follow_up_date")}:</span> <Ltr>{day(`${s.follow_up_date}T12:00:00+05:00`)}</Ltr></p>}
          {(lng === "ur" ? s.advice_ur || s.advice_en : s.advice_en) && (
            <section><p className="mc-rule border-b font-semibold">{pt("ds.p.advice")}</p>
              {lines(lng === "ur" ? s.advice_ur || s.advice_en : s.advice_en).map((l, i) => <p key={i}>{l}</p>)}</section>
          )}
        </div>
      )}
    </PrintPreviewPanel>
  );
}
