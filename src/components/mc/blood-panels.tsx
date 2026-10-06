import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { PatientFinder } from "@/components/mc/referral-panels";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import {
  BLOOD_GROUPS, BLOOD_INVALIDATE, COMPONENTS, URGENCIES, bloodExpiryTone, compatible, fmtWhen,
  type BloodRequest, type BloodUnit,
} from "@/lib/blood";

function Pick({ id, label, value, onChange, options, render }: { id: string; label: string; value: string; onChange: (v: string) => void; options: readonly string[]; render?: (v: string) => string }) {
  return (
    <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{render ? render(o) : o}</SelectItem>)}</SelectContent>
      </Select></div>
  );
}

/** Doctor / ER officer: ask the blood bank for units. Opened from the ER case panel and the blood bank page. */
export function BloodRequestPanel({ patient, defaultGroup, emergencyCaseId, onClose }: {
  patient?: { id: string; label: string } | null; defaultGroup?: string | null; emergencyCaseId?: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [pt, setPt] = useState(patient ?? null);
  const [f, setF] = useState({ blood_group: defaultGroup ?? "", component: "prbc", units: "1", urgency: emergencyCaseId ? "emergency" : "routine", reason: "" });
  const save = useEdgeFunction("request-blood", { invalidate: BLOOD_INVALIDATE, successMessage: t("bb.requested") });
  const submit = async () => {
    if (!pt) return;
    try {
      await save.mutateAsync({ patient_id: pt.id, emergency_case_id: emergencyCaseId, blood_group: f.blood_group || undefined, component: f.component, units: Number(f.units), urgency: f.urgency, reason: f.reason });
      onClose();
    } catch { /* toast shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={t("bb.newRequest")}
      footer={<><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button><Button onClick={submit} disabled={!pt || !f.blood_group || save.isPending}>{t("bb.send")}</Button></>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>{t("bb.patient")} *</Label>
          {patient ? <p className="text-sm font-medium">{patient.label}</p> : <PatientFinder value={pt} onChange={setPt} />}</div>
        <Pick id="br-group" label={`${t("bb.group")} *`} value={f.blood_group} onChange={(v) => setF({ ...f, blood_group: v })} options={BLOOD_GROUPS} />
        <Pick id="br-comp" label={t("bb.component")} value={f.component} onChange={(v) => setF({ ...f, component: v })} options={COMPONENTS} render={(v) => t(`bb.components.${v}`)} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="br-units">{t("bb.units")}</Label>
            <Input id="br-units" type="number" min={1} max={20} dir="ltr" value={f.units} onChange={(e) => setF({ ...f, units: e.target.value })} /></div>
          <Pick id="br-urg" label={t("bb.urgency")} value={f.urgency} onChange={(v) => setF({ ...f, urgency: v })} options={URGENCIES} render={(v) => t(`bb.urgencies.${v}`)} />
        </div>
        <div className="space-y-1.5"><Label htmlFor="br-reason">{t("bb.reason")}</Label>
          <Textarea id="br-reason" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
      </div>
    </SidePanel>
  );
}

/** Blood bank: add a unit to stock. */
export function RegisterUnitPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const now = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 16);
  const [f, setF] = useState({ unit_no: "", blood_group: "O+", component: "prbc", volume_ml: "", collected_at: now, expires_at: "", donor_name: "" });
  const save = useEdgeFunction("register-blood-unit", { invalidate: BLOOD_INVALIDATE, successMessage: t("bb.registered") });
  const submit = async () => {
    try {
      await save.mutateAsync({ ...f, volume_ml: f.volume_ml ? Number(f.volume_ml) : null,
        collected_at: `${f.collected_at}:00+05:00`, expires_at: f.expires_at ? `${f.expires_at}:00+05:00` : "" });
      onClose();
    } catch { /* toast shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={t("bb.register")}
      footer={<><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button><Button onClick={submit} disabled={!f.unit_no.trim() || !f.expires_at || save.isPending}>{t("bb.save")}</Button></>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="bu-no">{t("bb.unitNo")} *</Label>
          <Input id="bu-no" dir="ltr" value={f.unit_no} onChange={(e) => setF({ ...f, unit_no: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <Pick id="bu-group" label={t("bb.group")} value={f.blood_group} onChange={(v) => setF({ ...f, blood_group: v })} options={BLOOD_GROUPS} />
          <Pick id="bu-comp" label={t("bb.component")} value={f.component} onChange={(v) => setF({ ...f, component: v })} options={COMPONENTS} render={(v) => t(`bb.components.${v}`)} />
        </div>
        <div className="space-y-1.5"><Label htmlFor="bu-vol">{t("bb.volume")}</Label>
          <Input id="bu-vol" type="number" dir="ltr" value={f.volume_ml} onChange={(e) => setF({ ...f, volume_ml: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="bu-col">{t("bb.collected")} *</Label>
          <Input id="bu-col" type="datetime-local" dir="ltr" value={f.collected_at} onChange={(e) => setF({ ...f, collected_at: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="bu-exp">{t("bb.expires")} *</Label>
          <Input id="bu-exp" type="datetime-local" dir="ltr" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="bu-donor">{t("bb.donor")}</Label>
          <Input id="bu-donor" value={f.donor_name} onChange={(e) => setF({ ...f, donor_name: e.target.value })} /></div>
      </div>
    </SidePanel>
  );
}

/** Blood bank: crossmatch a request against compatible stock, then issue the reserved units. */
export function RequestPanel({ r, units, canBank, onClose }: { r: BloodRequest; units: BloodUnit[]; canBank: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<"compatible" | "incompatible">("compatible");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const xm = useEdgeFunction("crossmatch-blood", { invalidate: BLOOD_INVALIDATE, successMessage: t("bb.crossmatched") });
  const issue = useEdgeFunction("issue-blood", { invalidate: [...BLOOD_INVALIDATE, ["invoices"], ["billing"]], successMessage: t("bb.issuedOk") });
  const reserved = units.filter((u) => r.reserved_unit_ids.includes(u.id));
  const candidates = units.filter((u) => u.status === "available" && u.component === r.component && compatible(r.component, u.blood_group, r.blood_group) && new Date(u.expires_at).getTime() > Date.now());
  const remaining = r.units - r.units_issued;
  const canXm = canBank && ["requested", "crossmatched", "incompatible"].includes(r.status);
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={`${r.patients?.full_name ?? ""} · ${r.blood_group}`}
      description={`${t(`bb.components.${r.component}`)} × ${r.units} · ${t(`bb.urgencies.${r.urgency}`)}`}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap gap-2">
          <Ltr className="font-mono">{r.patients?.mrn}</Ltr>
          <StatusChip status="caution">{t(`bb.reqStatus.${r.status}`)}</StatusChip>
          <span className="text-muted-foreground">{t("bb.issuedOf", { n: r.units_issued, total: r.units })}</span>
        </div>
        {r.reason && <p className="text-muted-foreground" dir="auto">{r.reason}</p>}
        {r.crossmatch_note && <p className="rounded-md bg-muted p-2" dir="auto">{r.crossmatch_note}</p>}

        {reserved.length > 0 && (
          <section className="space-y-2">
            <h3 className="font-medium">{t("bb.reserved")}</h3>
            {reserved.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div><Ltr className="font-mono font-semibold">{u.unit_no}</Ltr> · <Ltr>{u.blood_group}</Ltr>
                  <div><StatusChip status={bloodExpiryTone(u.expires_at)}>{t("bb.expiresAt")} <Ltr>{fmtWhen(u.expires_at)}</Ltr></StatusChip></div></div>
                {canBank && <Button size="sm" disabled={issue.isPending} onClick={() => void issue.mutateAsync({ request_id: r.id, unit_id: u.id }).catch(() => undefined)}>{t("bb.issue")}</Button>}
              </div>
            ))}
          </section>
        )}

        {canXm && (
          <section className="space-y-3 rounded-md border p-3">
            <h3 className="font-medium">{t("bb.crossmatch")}</h3>
            <div className="grid grid-cols-2 gap-2">
              {(["compatible", "incompatible"] as const).map((v) => (
                <Button key={v} type="button" variant={result === v ? (v === "compatible" ? "default" : "destructive") : "outline"} onClick={() => setResult(v)}>{t(`bb.xm.${v}`)}</Button>
              ))}
            </div>
            {result === "compatible" && (
              candidates.length ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t("bb.pickUnits", { n: remaining })}</p>
                  {candidates.map((u) => {
                    const on = picked.includes(u.id);
                    return (
                      <label key={u.id} className="flex items-center gap-2 rounded-md border p-2">
                        <Checkbox checked={on} disabled={!on && picked.length >= remaining}
                          onCheckedChange={(c) => setPicked((p) => c ? [...p, u.id] : p.filter((x) => x !== u.id))} />
                        <Ltr className="font-mono">{u.unit_no}</Ltr> <Ltr>{u.blood_group}</Ltr>
                        <StatusChip status={bloodExpiryTone(u.expires_at)} className="ms-auto"><Ltr>{fmtWhen(u.expires_at)}</Ltr></StatusChip>
                      </label>
                    );
                  })}
                </div>
              ) : <p className="text-destructive">{t("bb.noCompatible")}</p>
            )}
            <div className="space-y-1.5"><Label htmlFor="xm-note">{t("bb.note")}{result === "incompatible" ? " *" : ""}</Label>
              <Textarea id="xm-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Button className="w-full" disabled={xm.isPending || (result === "compatible" ? !picked.length : !note.trim())}
              onClick={() => void xm.mutateAsync({ request_id: r.id, result, unit_ids: picked, note }).then(() => setPicked([])).catch(() => undefined)}>{t("bb.saveXm")}</Button>
          </section>
        )}
      </div>
    </SidePanel>
  );
}

/** Blood bank: discard (available/reserved) or take back (issued) a unit, reason required. */
export function UnitActionPanel({ u, onClose }: { u: BloodUnit; onClose: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const isReturn = u.status === "issued";
  const act = useEdgeFunction(isReturn ? "return-blood" : "discard-blood", { invalidate: [...BLOOD_INVALIDATE, ["invoices"]], successMessage: isReturn ? t("bb.returned") : t("bb.discarded") });
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={`${isReturn ? t("bb.return") : t("bb.discard")} · ${u.unit_no}`}
      footer={<><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button>
        <Button variant={isReturn ? "default" : "destructive"} disabled={reason.trim().length < 3 || act.isPending}
          onClick={() => void act.mutateAsync({ unit_id: u.id, reason }).then(onClose).catch(() => undefined)}>{isReturn ? t("bb.return") : t("bb.discard")}</Button></>}>
      <div className="space-y-3 text-sm">
        <p><Ltr className="font-semibold">{u.blood_group}</Ltr> · {t(`bb.components.${u.component}`)}</p>
        {isReturn && <p className="text-muted-foreground">{t("bb.returnHint")}</p>}
        <div className="space-y-1.5"><Label htmlFor="ua-reason">{t("bb.reason")} *</Label>
          <Textarea id="ua-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
    </SidePanel>
  );
}
