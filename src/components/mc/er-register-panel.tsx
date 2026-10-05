import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SidePanel } from "@/components/mc/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { cn } from "@/lib/utils";
import { ARRIVAL_MODES, ER_INVALIDATE, TRIAGE_BG, TRIAGE_COLORS, type TriageColor } from "@/lib/emergency";

/** Rapid ER registration: name (or Unknown), gender, approx. age, complaint. Triage and arrival are optional. */
export function ErRegisterPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const [unknown, setUnknown] = useState(false);
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [complaint, setComplaint] = useState("");
  const [phone, setPhone] = useState("");
  const [mode, setMode] = useState<string>("walk_in");
  const [triage, setTriage] = useState<TriageColor | null>(null);
  const save = useEdgeFunction("register-emergency", { invalidate: ER_INVALIDATE, successMessage: t("er.registered") });

  const reset = () => { setUnknown(false); setName(""); setGender(""); setAge(""); setComplaint(""); setPhone(""); setMode("walk_in"); setTriage(null); };
  const submit = async () => {
    if ((!unknown && name.trim().length < 2) || !gender || (!unknown && age === "") || complaint.trim().length < 2) { toast.error(t("er.fillRequired")); return; }
    try {
      await save.mutateAsync({
        new_patient: { is_unknown: unknown, full_name: unknown ? "" : name, gender, age_years: age === "" ? null : Number(age), phone },
        complaint, arrival_mode: mode, triage_color: triage,
      });
      reset(); onOpenChange(false);
    } catch { /* toast shown */ }
  };

  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title={t("er.registerTitle")} description={t("er.registerHint")}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>{t("wd.cancel")}</Button><Button onClick={submit} disabled={save.isPending}>{t("er.register")}</Button></>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-md border p-3">
          <Label htmlFor="er-unknown">{t("er.unknown")}</Label>
          <Switch id="er-unknown" checked={unknown} onCheckedChange={setUnknown} />
        </div>
        {!unknown && (
          <div className="space-y-1.5"><Label htmlFor="er-name">{t("er.name")} *</Label>
            <Input id="er-name" className="h-11 text-base" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        )}
        <div className="space-y-1.5"><Label>{t("er.gender")} *</Label>
          <div className="grid grid-cols-3 gap-2">
            {["male", "female", "other"].map((g) => (
              <Button key={g} type="button" variant={gender === g ? "default" : "outline"} className="h-11" onClick={() => setGender(g)}>{t(`er.genders.${g}`)}</Button>
            ))}
          </div></div>
        <div className="space-y-1.5"><Label htmlFor="er-age">{t("er.age")}{unknown ? "" : " *"}</Label>
          <Input id="er-age" type="number" inputMode="numeric" min={0} max={120} className="h-11 text-base" dir="ltr" value={age} onChange={(e) => setAge(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="er-complaint">{t("er.complaint")} *</Label>
          <Textarea id="er-complaint" rows={2} className="text-base" value={complaint} maxLength={500} onChange={(e) => setComplaint(e.target.value)} /></div>

        <div className="space-y-1.5"><Label>{t("er.triage")}</Label>
          <div className="grid grid-cols-4 gap-2">
            {TRIAGE_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setTriage(triage === c ? null : c)}
                className={cn("h-11 rounded-md text-sm font-semibold ring-offset-2 ring-offset-background", TRIAGE_BG[c], triage === c ? "ring-2 ring-ring" : "opacity-60")}>
                {t(`er.colors.${c}`)}
              </button>
            ))}
          </div></div>
        <div className="space-y-1.5"><Label>{t("er.arrival")}</Label>
          <div className="grid grid-cols-2 gap-2">
            {ARRIVAL_MODES.map((m) => (
              <Button key={m} type="button" size="sm" variant={mode === m ? "secondary" : "ghost"} className={cn(mode === m && "ring-1 ring-ring")} onClick={() => setMode(m)}>{t(`er.modes.${m}`)}</Button>
            ))}
          </div></div>
        {!unknown && (
          <div className="space-y-1.5"><Label htmlFor="er-phone">{t("er.phone")}</Label>
            <Input id="er-phone" type="tel" dir="ltr" value={phone} maxLength={15} onChange={(e) => setPhone(e.target.value)} /></div>
        )}
        <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">{t("er.noPayment")}</p>
      </div>
    </SidePanel>
  );
}
