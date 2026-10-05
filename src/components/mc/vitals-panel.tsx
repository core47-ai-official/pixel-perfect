import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SidePanel } from "@/components/mc/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEdgeFunction } from "@/hooks/use-edge-function";

const FIELDS = [
  ["bp_sys", "nb.vitals.sys"], ["bp_dia", "nb.vitals.dia"], ["pulse", "nb.vitals.pulse"], ["temp_c", "nb.vitals.temp"],
  ["spo2", "nb.vitals.spo2"], ["rr", "nb.vitals.rr"], ["weight_kg", "nb.vitals.weight"],
] as const;
type Key = (typeof FIELDS)[number][0];

/** Quick vitals entry with large touch-friendly inputs. Saves through record-vitals. */
export function VitalsPanel({ patientId, title, onClose }: { patientId: string; title: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState<Record<Key, string>>({ bp_sys: "", bp_dia: "", pulse: "", temp_c: "", spo2: "", rr: "", weight_kg: "" });
  const save = useEdgeFunction("record-vitals", { invalidate: [["ward-board"], ["vitals", patientId]], successMessage: t("nb.vitals.saved") });
  const submit = async () => {
    const body: Record<string, number> = {};
    for (const [k] of FIELDS) if (v[k].trim()) body[k] = Number(v[k]);
    if (!Object.keys(body).length) { toast.error(t("nb.vitals.needOne")); return; }
    try { await save.mutateAsync({ patient_id: patientId, ...body }); onClose(); } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={title}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" size="lg" onClick={onClose}>{t("wd.cancel")}</Button><Button size="lg" onClick={submit} disabled={save.isPending}>{t("wd.save")}</Button></div>}>
      <div className="grid grid-cols-2 gap-4">
        {FIELDS.map(([k, label]) => (
          <div key={k} className="space-y-1.5">
            <Label htmlFor={`v-${k}`} className="text-sm">{t(label)}</Label>
            <Input id={`v-${k}`} dir="ltr" inputMode="decimal" className="h-14 text-2xl font-semibold tnum" value={v[k]}
              onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^\d.]/g, "") })} />
          </div>
        ))}
      </div>
    </SidePanel>
  );
}
