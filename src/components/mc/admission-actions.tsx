import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SidePanel } from "@/components/mc/side-panel";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { BedPicker } from "@/components/mc/bed-picker";
import { ADMISSION_INVALIDATE, DISCHARGE_TYPES } from "@/lib/admissions";

export function TransferPanel({ admissionId, currentBedId, patientGender, patientName, onClose }: {
  admissionId: string; currentBedId: string | null; patientGender: string | null; patientName: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [bed, setBed] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const save = useEdgeFunction("transfer-patient", { invalidate: ADMISSION_INVALIDATE, successMessage: t("adm.transferred") });
  const submit = async () => {
    if (!bed || reason.trim().length < 3) { toast.error(t("wd.required")); return; }
    try { await save.mutateAsync({ admission_id: admissionId, to_bed_id: bed, reason }); onClose(); } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={`${t("adm.transfer")} · ${patientName}`}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button><Button onClick={submit} disabled={save.isPending}>{t("adm.transfer")}</Button></div>}>
      <div className="space-y-4">
        <BedPicker patientGender={patientGender} value={bed} onChange={setBed} excludeId={currentBedId} />
        <div className="space-y-1.5"><Label htmlFor="tr-reason">{t("adm.transferReason")}</Label>
          <Textarea id="tr-reason" rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></div>
        <p className="text-xs text-muted-foreground">{t("adm.transferNote")}</p>
      </div>
    </SidePanel>
  );
}

export function DischargePanel({ admissionId, patientName, bedLabel, onClose }: { admissionId: string; patientName: string; bedLabel?: string | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  const [type, setType] = useState<string>("regular");
  const [note, setNote] = useState("");
  const save = useEdgeFunction("discharge-patient", { invalidate: ADMISSION_INVALIDATE, successMessage: t("adm.discharged") });
  const submit = async () => {
    try { await save.mutateAsync({ admission_id: admissionId, discharge_type: type, note }); onClose(); } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={`${t("adm.discharge")} · ${patientName}`}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button><Button onClick={submit} disabled={save.isPending}>{t("adm.discharge")}</Button></div>}>
      <div className="space-y-4">
        {bedLabel && <p className="text-sm">{t("bb.bed")} <Ltr className="font-mono font-semibold">{bedLabel}</Ltr></p>}
        <div className="space-y-1.5"><Label>{t("adm.dischargeType")}</Label>
          <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{DISCHARGE_TYPES.map((d) => <SelectItem key={d} value={d}>{t(`adm.dtypes.${d}`)}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label htmlFor="dc-note">{t("adm.dischargeNote")}</Label>
          <Textarea id="dc-note" rows={4} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></div>
        <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">{t("adm.billingNote")}</p>
      </div>
    </SidePanel>
  );
}
