import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Ltr } from "@/components/mc/ltr";
import { StatusChip } from "@/components/mc/status-chip";
import { SidePanel } from "@/components/mc/side-panel";
import { TransferPanel, DischargePanel } from "@/components/mc/admission-actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { useBeds, useWards, WARD_TYPES } from "@/lib/beds";
import { ADMISSION_INVALIDATE, usePatientAdmissions } from "@/lib/admissions";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" });
const MOVE = ["super_admin", "admin", "dept_head", "doctor", "nurse"];
const ADMIT = [...MOVE, "er_officer", "receptionist"];

export function PatientAdmissionsTab({ patient }: { patient: { id: string; full_name: string; gender: string | null } }) {
  const { t } = useTranslation();
  const { context } = useMyContext();
  const roles = (context?.roles ?? []) as string[];
  const canMove = roles.some((r) => MOVE.includes(r));
  const canAdmit = roles.some((r) => ADMIT.includes(r));
  const list = usePatientAdmissions(patient.id);
  const beds = useBeds();
  const wards = useWards();
  const [panel, setPanel] = useState<"transfer" | "discharge" | "request" | null>(null);
  const bedName = (id: string | null) => {
    const b = (beds.data ?? []).find((x) => x.id === id);
    const w = (wards.data ?? []).find((x) => x.id === b?.ward_id);
    return b ? `${b.label} · ${w?.name ?? ""}` : "—";
  };
  if (list.isLoading) return <Skeleton className="h-40" />;
  const active = (list.data ?? []).find((a) => a.status === "admitted");
  return (
    <div className="space-y-4">
      {!active && canAdmit && (
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link to="/admissions/new" search={{ patient: patient.id }}>{t("adm.admit")}</Link></Button>
          <Button variant="outline" onClick={() => setPanel("request")}>{t("adm.requestBed")}</Button>
        </div>
      )}
      {(list.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t("adm.none")}</p> : (list.data ?? []).map((a) => (
        <div key={a.id} className="rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={a.status === "admitted" ? "progress" : "inactive"}>{t(`adm.status.${a.status}`)}</StatusChip>
            <Ltr className="font-mono text-sm font-semibold">{bedName(a.bed_id)}</Ltr>
            <span className="ms-auto text-xs text-muted-foreground"><Ltr>{fmt(a.admitted_at)}</Ltr>{a.discharged_at && <> → <Ltr>{fmt(a.discharged_at)}</Ltr></>}</span>
          </div>
          <p className="mt-2 text-sm">{a.reason}</p>
          {a.discharge_type && <p className="mt-1 text-xs text-muted-foreground">{t("adm.dischargeType")}: {t(`adm.dtypes.${a.discharge_type}`)}</p>}
          {a.transfers.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{t("adm.transfers", { count: a.transfers.length })}</p>}
          {a.status === "admitted" && canMove && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setPanel("transfer")}>{t("adm.transfer")}</Button>
              <Button size="sm" variant="outline" onClick={() => setPanel("discharge")}>{t("adm.discharge")}</Button>
            </div>
          )}
        </div>
      ))}
      {panel === "transfer" && active && <TransferPanel admissionId={active.id} currentBedId={active.bed_id} patientGender={patient.gender} patientName={patient.full_name} onClose={() => setPanel(null)} />}
      {panel === "discharge" && active && <DischargePanel admissionId={active.id} patientName={patient.full_name} bedLabel={bedName(active.bed_id)} onClose={() => setPanel(null)} />}
      {panel === "request" && <RequestBedPanel patientId={patient.id} patientName={patient.full_name} onClose={() => setPanel(null)} />}
    </div>
  );
}

export function RequestBedPanel({ patientId, patientName, onClose }: { patientId: string; patientName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ source: "opd", bed_class: "general", priority: "routine", note: "" });
  const save = useEdgeFunction("request-bed", { invalidate: ADMISSION_INVALIDATE, successMessage: t("adm.requested") });
  const submit = async () => {
    if (!f.bed_class) { toast.error(t("wd.required")); return; }
    try { await save.mutateAsync({ patient_id: patientId, ...f }); onClose(); } catch { /* shown */ }
  };
  const pick = (k: "source" | "bed_class" | "priority", label: string, opts: readonly string[], prefix: string) => (
    <div className="space-y-1.5"><Label>{label}</Label>
      <Select value={f[k]} onValueChange={(v) => setF({ ...f, [k]: v })}><SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{opts.map((o) => <SelectItem key={o} value={o}>{t(`${prefix}.${o}`)}</SelectItem>)}</SelectContent></Select></div>
  );
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={`${t("adm.requestBed")} · ${patientName}`}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button><Button onClick={submit} disabled={save.isPending}>{t("adm.requestBed")}</Button></div>}>
      <div className="space-y-4">
        {pick("source", t("adm.source"), ["opd", "er"], "adm.sources")}
        {pick("bed_class", t("wd.class"), WARD_TYPES, "wd.types")}
        {pick("priority", t("adm.priority"), ["routine", "urgent"], "adm.priorities")}
        <div className="space-y-1.5"><Label htmlFor="rq-note">{t("adm.reason")}</Label>
          <Textarea id="rq-note" rows={3} maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      </div>
    </SidePanel>
  );
}
