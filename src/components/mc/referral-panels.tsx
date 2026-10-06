import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { SidePanel } from "@/components/mc/side-panel";
import { Ltr } from "@/components/mc/ltr";
import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callEdgeFunction, useEdgeFunction } from "@/hooks/use-edge-function";
import { supabase } from "@/integrations/supabase/client";
import { fetchReferral, REFERRAL_INVALIDATE, REFERRAL_NEXT, REFERRAL_URGENCY, type Referral } from "@/lib/referrals";

const when = (iso: string) => new Date(iso).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" });

/** Small patient finder (MRN, name, phone) for referrals started outside a patient context. */
export function PatientFinder({ value, onChange }: { value: { id: string; label: string } | null; onChange: (p: { id: string; label: string } | null) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const res = useQuery({
    queryKey: ["referral-patient-find", q], enabled: q.trim().length >= 2,
    queryFn: async () => {
      const term = q.trim().replace(/[%,()]/g, "");
      const { data } = await supabase.from("patients").select("id, full_name, mrn").or(`mrn.ilike.%${term}%,full_name.ilike.%${term}%,phone.ilike.%${term}%`).limit(8);
      return data ?? [];
    },
  });
  if (value) return (
    <div className="flex items-center justify-between rounded-staff border p-2 text-sm"><span>{value.label}</span>
      <Button size="sm" variant="ghost" onClick={() => onChange(null)}>{t("ref.change")}</Button></div>
  );
  return (
    <div className="space-y-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ref.findPatient")} aria-label={t("ref.findPatient")} />
      {(res.data ?? []).map((p) => (
        <button key={p.id} type="button" className="block w-full rounded-staff px-2 py-1.5 text-start text-sm hover:bg-muted"
          onClick={() => onChange({ id: p.id, label: `${p.full_name} · ${p.mrn}` })}>{p.full_name} · <Ltr className="font-mono">{p.mrn}</Ltr></button>
      ))}
    </div>
  );
}

export function ReferralFormPanel({ direction: initialDir = "out", patient, emergencyCaseId, visitId, onClose, onSaved }: {
  direction?: "in" | "out"; patient?: { id: string; label: string } | null; emergencyCaseId?: string; visitId?: string;
  onClose: () => void; onSaved?: (r: Referral) => void;
}) {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<"in" | "out">(initialDir);
  const [pt, setPt] = useState(patient ?? null);
  const [f, setF] = useState({ facility: "", reason: "", urgency: emergencyCaseId ? "urgent" : "routine", contact_person: "", contact_phone: "", summary: "" });
  const [loadingSummary, setLoadingSummary] = useState(false);
  const save = useEdgeFunction<Referral>("create-referral", { invalidate: REFERRAL_INVALIDATE, successMessage: t("ref.saved") });
  const loadSummary = async (pid: string) => {
    setLoadingSummary(true);
    try {
      const d = await callEdgeFunction<{ summary: string }>("create-referral", { preview: true, patient_id: pid, emergency_case_id: emergencyCaseId, visit_id: visitId });
      setF((x) => ({ ...x, summary: d.summary }));
    } catch { /* shown */ } finally { setLoadingSummary(false); }
  };
  useEffect(() => { if (pt && direction === "out" && !f.summary) void loadSummary(pt.id); }, [pt?.id, direction]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (!pt || !f.facility.trim() || !f.reason.trim()) { toast.error(t("wd.required")); return; }
    try {
      const r = await save.mutateAsync({ patient_id: pt.id, direction, [direction === "out" ? "to_facility" : "from_facility"]: f.facility, reason: f.reason, urgency: f.urgency,
        contact_person: f.contact_person, contact_phone: f.contact_phone, summary: f.summary, emergency_case_id: emergencyCaseId, visit_id: visitId });
      onSaved?.(await fetchReferral(r.id)); onClose();
    } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={t(direction === "out" ? "ref.newOut" : "ref.newIn")}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button>
        <Button onClick={submit} disabled={save.isPending}>{t(direction === "out" ? "ref.sendAndPrint" : "ref.saveIn")}</Button></div>}>
      <div className="space-y-4">
        {!emergencyCaseId && (
          <div className="inline-flex rounded-staff border p-0.5">
            {(["out", "in"] as const).map((d) => <Button key={d} size="sm" variant={direction === d ? "primary" : "ghost"} onClick={() => setDirection(d)}>{t(`ref.dir.${d}`)}</Button>)}
          </div>
        )}
        <div className="space-y-1.5"><Label>{t("ref.patient")} *</Label>
          {patient ? <p className="text-sm font-medium">{patient.label}</p> : <PatientFinder value={pt} onChange={setPt} />}</div>
        <div className="space-y-1.5"><Label htmlFor="rf-fac">{t(direction === "out" ? "ref.toFacility" : "ref.fromFacility")} *</Label>
          <Input id="rf-fac" value={f.facility} maxLength={200} onChange={(e) => setF({ ...f, facility: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="rf-reason">{t("ref.reason")} *</Label>
          <Textarea id="rf-reason" rows={2} value={f.reason} maxLength={2000} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>{t("ref.urgency")}</Label>
          <Select value={f.urgency} onValueChange={(v) => setF({ ...f, urgency: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{REFERRAL_URGENCY.map((u) => <SelectItem key={u} value={u}>{t(`ref.urg.${u}`)}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="rf-cp">{t("ref.contactPerson")}</Label>
            <Input id="rf-cp" value={f.contact_person} maxLength={200} onChange={(e) => setF({ ...f, contact_person: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="rf-ph">{t("ref.contactPhone")}</Label>
            <Input id="rf-ph" dir="ltr" inputMode="tel" value={f.contact_phone} maxLength={30} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between"><Label htmlFor="rf-sum">{t("ref.summary")}</Label>
            {pt && direction === "out" && <Button size="sm" variant="ghost" disabled={loadingSummary} onClick={() => loadSummary(pt.id)}>{t("ref.refill")}</Button>}</div>
          {loadingSummary ? <Skeleton className="h-32" /> :
            <Textarea id="rf-sum" rows={8} dir="ltr" value={f.summary} maxLength={8000} onChange={(e) => setF({ ...f, summary: e.target.value })} />}
          {direction === "out" && <p className="text-xs text-muted-foreground">{t("ref.summaryHint")}</p>}
        </div>
      </div>
    </SidePanel>
  );
}

export function ReferralStatusPanel({ r, onClose }: { r: Referral; onClose: () => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const save = useEdgeFunction("update-referral-status", { invalidate: REFERRAL_INVALIDATE, successMessage: t("ref.updated") });
  const go = async (status: string) => {
    if (status === "rejected" && !note.trim()) { toast.error(t("ref.rejectNote")); return; }
    try { await save.mutateAsync({ referral_id: r.id, status, note }); onClose(); } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={`${t("ref.updateStatus")} · ${r.patients?.full_name ?? ""}`}
      footer={<div className="flex flex-wrap justify-end gap-2">{(REFERRAL_NEXT[r.status] ?? []).map((s) => (
        <Button key={s} variant={s === "rejected" ? "destructive" : "primary"} disabled={save.isPending} onClick={() => go(s)}>{t(`ref.to.${s}`)}</Button>
      ))}</div>}>
      <div className="space-y-1.5"><Label htmlFor="rs-note">{t("ref.statusNote")}</Label>
        <Textarea id="rs-note" rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></div>
    </SidePanel>
  );
}

export function ReferralLetter({ r, onClose }: { r: Referral; onClose: () => void }) {
  const brand = usePrintBrand();
  const age = r.patients?.dob ? Math.floor((Date.now() - new Date(r.patients.dob).getTime()) / 31557600000) : null;
  return (
    <PrintPreviewPanel open onOpenChange={(o) => !o && onClose()} brand={brand} paper="a4" allowPaperChange={false} showSignature
      printLanguage={r.patients?.print_language === "ur" ? "ur" : null} job={{ documentType: "referral_letter", documentId: r.id, patientId: r.patient_id }}>
      {(pt) => (
        <div className="space-y-3 text-sm">
          <p className="text-center text-base font-bold uppercase">{pt("ref.p.title")}</p>
          <div className="grid grid-cols-2 gap-x-4">
            <span>{pt("ref.p.date")}: <Ltr>{when(r.created_at)}</Ltr></span>
            <span>{pt("ref.urgency")}: {pt(`ref.urg.${r.urgency}`)}</span>
            <span>{pt("ref.p.to")}: <Ltr>{r.to_facility}</Ltr></span>
            <span>{pt("ref.p.from")}: <Ltr>{r.from_facility}</Ltr></span>
            <span>{pt("ref.patient")}: {r.patients?.full_name}</span>
            <span>{pt("ref.p.mrn")}: <Ltr>{r.patients?.mrn}</Ltr>{age != null && <> · <Ltr>{age} y</Ltr></>}{r.patients?.gender && <> · {r.patients.gender}</>}</span>
          </div>
          <section><p className="mc-rule border-b font-semibold">{pt("ref.reason")}</p><p dir="ltr" className="whitespace-pre-line text-start">{r.reason}</p></section>
          {r.summary && <section><p className="mc-rule border-b font-semibold">{pt("ref.p.summary")}</p><p dir="ltr" className="whitespace-pre-line text-start">{r.summary}</p></section>}
          {(r.contact_person || r.contact_phone) && <p>{pt("ref.p.contact")}: <Ltr>{[r.contact_person, r.contact_phone].filter(Boolean).join(" · ")}</Ltr></p>}
          <p>{pt("ref.p.by")}: <Ltr>{r.referred_by_name ?? "—"}</Ltr></p>
        </div>
      )}
    </PrintPreviewPanel>
  );
}
