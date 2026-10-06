import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Check, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { BLOOD_GROUPS, TRACKER_CONDITIONS, useLinkedPatientDetails } from "@/lib/tracker";
import { cn } from "@/lib/utils";

type Med = { name: string; dose: string };
const STEPS = 7;

/** Seven one-question screens; nothing is saved until the last screen sends everything to save-tracker-onboarding. */
export function TrackerOnboarding() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const prefill = useLinkedPatientDetails();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [blood, setBlood] = useState("");
  const [ec, setEc] = useState({ name: "", relation: "", phone: "" });
  const [status, setStatus] = useState<"" | "none" | "has_conditions">("");
  const [conds, setConds] = useState<Set<string>>(new Set());
  const [other, setOther] = useState("");
  const [q, setQ] = useState("");
  const [meds, setMeds] = useState<Med[]>([]);
  const [consent, setConsent] = useState(false);
  const [disclaimer, setDisclaimer] = useState(false);

  useEffect(() => {
    const p = prefill.data;
    if (!p) return;
    if (p.dob) setDob((v) => v || p.dob!.slice(0, 10));
    if (p.gender && ["male", "female", "other"].includes(p.gender)) setGender((v) => v || p.gender!);
    if (p.blood_group && (BLOOD_GROUPS as readonly string[]).includes(p.blood_group)) setBlood((v) => v || p.blood_group!);
    if (p.guardian_name || p.guardian_phone) setEc((v) => (v.name || v.phone ? v : { name: p.guardian_name ?? "", relation: "", phone: p.guardian_phone ?? "" }));
  }, [prefill.data]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return TRACKER_CONDITIONS.filter(([id, en]) => !s || en.toLowerCase().includes(s) || t(`trk.cond.${id}`).toLowerCase().includes(s));
  }, [q, t]);

  const h = Number(height), w = Number(weight);
  const valid = [
    !!dob && dob <= new Date().toISOString().slice(0, 10) && !!gender && h >= 30 && h <= 260 && w >= 1 && w <= 400,
    !ec.phone || /^[0-9+\- ]{7,20}$/.test(ec.phone),
    !!status,
    conds.size > 0 || other.trim().length > 1,
    true,
    consent,
    disclaimer,
  ];
  const next = () => setStep((s) => (s === 2 && status === "none" ? 4 : s + 1));
  const back = () => setStep((s) => (s === 4 && status === "none" ? 2 : s - 1));

  const finish = async () => {
    setBusy(true);
    try {
      const names: { name: string }[] = TRACKER_CONDITIONS.filter(([id]) => conds.has(id)).map(([, en]) => ({ name: en }));
      if (other.trim()) names.push({ name: other.trim() });
      await callEdgeFunction("save-tracker-onboarding", {
        dob, gender, height_cm: h, weight_kg: w, blood_group: blood || null, emergency_contact: ec, health_status: status,
        conditions: status === "has_conditions" ? names : [], medicines: meds.filter((m) => m.name.trim()), consent, disclaimer,
      });
      await qc.invalidateQueries({ queryKey: ["tracker-profile"] });
      await qc.invalidateQueries({ queryKey: ["tracker-lists"] });
      toast.success(t("trk.done"));
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-center gap-2" aria-label={t("trk.stepOf", { n: step + 1, total: STEPS })}>
        {Array.from({ length: STEPS }, (_, i) => (
          <span key={i} className={cn("size-2.5 rounded-full transition-colors", i === step ? "bg-primary" : i < step ? "bg-primary/40" : "bg-muted")} />
        ))}
      </div>
      <PCard className="space-y-4">
        {step === 0 && (
          <>
            <h2 className="text-xl font-semibold">{t("trk.s1")}</h2>
            {prefill.data && <p className="text-xs text-muted-foreground">{t("trk.prefilled")}</p>}
            <div className="space-y-1"><Label htmlFor="ob-dob">{t("trk.dob")}</Label><Input id="ob-dob" type="date" dir="ltr" value={dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDob(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>{t("trk.gender")}</Label>
              <div className="grid grid-cols-3 gap-2">{["male", "female", "other"].map((g) => <Choice key={g} on={gender === g} onClick={() => setGender(g)}>{t(`trk.g.${g}`)}</Choice>)}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="ob-h">{t("trk.heightCm")}</Label><Input id="ob-h" inputMode="decimal" dir="ltr" value={height} onChange={(e) => setHeight(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
              <div className="space-y-1"><Label htmlFor="ob-w">{t("trk.weightKg")}</Label><Input id="ob-w" inputMode="decimal" dir="ltr" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h2 className="text-xl font-semibold">{t("trk.s2")}</h2>
            <div className="space-y-1">
              <Label>{t("trk.bloodGroupOpt")}</Label>
              <div className="grid grid-cols-4 gap-2" dir="ltr">{BLOOD_GROUPS.map((g) => <Choice key={g} on={blood === g} onClick={() => setBlood(blood === g ? "" : g)}>{g}</Choice>)}</div>
            </div>
            <p className="font-medium">{t("trk.emergencyContact")}</p>
            <div className="space-y-1"><Label htmlFor="ob-ecn">{t("trk.ecName")}</Label><Input id="ob-ecn" maxLength={100} value={ec.name} onChange={(e) => setEc({ ...ec, name: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="ob-ecr">{t("trk.ecRelation")}</Label><Input id="ob-ecr" maxLength={50} value={ec.relation} onChange={(e) => setEc({ ...ec, relation: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="ob-ecp">{t("trk.ecPhone")}</Label><Input id="ob-ecp" type="tel" dir="ltr" maxLength={20} placeholder="03xx xxxxxxx" value={ec.phone} onChange={(e) => setEc({ ...ec, phone: e.target.value })} /></div>
          </>
        )}
        {step === 2 && (
          <>
            <h2 className="text-xl font-semibold">{t("trk.s3")}</h2>
            <Choice big on={status === "none"} onClick={() => setStatus("none")}>{t("trk.noIssues")}</Choice>
            <Choice big on={status === "has_conditions"} onClick={() => setStatus("has_conditions")}>{t("trk.hasConditions")}</Choice>
          </>
        )}
        {step === 3 && (
          <>
            <h2 className="text-xl font-semibold">{t("trk.s4")}</h2>
            <div className="relative"><Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input className="ps-9" placeholder={t("trk.searchCond")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {filtered.map(([id]) => (
                <li key={id}>
                  <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-accent">
                    <Checkbox checked={conds.has(id)} onCheckedChange={(v) => setConds((s) => { const n = new Set(s); if (v === true) n.add(id); else n.delete(id); return n; })} />
                    {t(`trk.cond.${id}`)}
                  </label>
                </li>
              ))}
            </ul>
            <div className="space-y-1"><Label htmlFor="ob-other">{t("trk.other")}</Label><Input id="ob-other" maxLength={120} value={other} onChange={(e) => setOther(e.target.value)} /></div>
          </>
        )}
        {step === 4 && (
          <>
            <h2 className="text-xl font-semibold">{t("trk.s5")}</h2>
            <p className="text-sm text-muted-foreground">{t("trk.medsHint")}</p>
            {meds.map((m, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label={t("trk.medName")} placeholder={t("trk.medName")} dir="ltr" maxLength={120} value={m.name} onChange={(e) => setMeds(meds.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <Input aria-label={t("trk.medDose")} placeholder={t("trk.medDose")} dir="ltr" className="w-24" maxLength={60} value={m.dose} onChange={(e) => setMeds(meds.map((x, j) => (j === i ? { ...x, dose: e.target.value } : x)))} />
                <Button variant="ghost" size="icon" aria-label={t("trk.remove")} onClick={() => setMeds(meds.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <Button variant="outline" className="w-full" disabled={meds.length >= 30} onClick={() => setMeds([...meds, { name: "", dose: "" }])}><Plus className="size-4" />{t("trk.addMed")}</Button>
          </>
        )}
        {step === 5 && (
          <>
            <ShieldCheck className="size-10 text-primary" aria-hidden />
            <h2 className="text-xl font-semibold">{t("trk.s6")}</h2>
            <ul className="list-disc space-y-1 ps-5 text-sm">
              <li>{t("trk.consent1")}</li><li>{t("trk.consent2")}</li><li>{t("trk.consent3")}</li><li>{t("trk.consent4")}</li>
            </ul>
            <label className="flex items-start gap-3 text-sm font-medium"><Checkbox className="mt-0.5" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />{t("trk.consentAgree")}</label>
          </>
        )}
        {step === 6 && (
          <>
            <AlertTriangle className="size-10 text-urgent-fg" aria-hidden />
            <h2 className="text-xl font-semibold">{t("trk.s7")}</h2>
            <p className="text-sm">{t("trk.disclaimer")}</p>
            <div className="grid grid-cols-2 gap-2">
              <a href="tel:1122" className="rounded-patient bg-urgent-soft p-3 text-center"><span className="block text-xs text-urgent-fg">{t("trk.rescue")}</span><Ltr className="text-2xl font-bold text-urgent-fg">1122</Ltr></a>
              <a href="tel:115" className="rounded-patient bg-urgent-soft p-3 text-center"><span className="block text-xs text-urgent-fg">{t("trk.edhi")}</span><Ltr className="text-2xl font-bold text-urgent-fg">115</Ltr></a>
            </div>
            <label className="flex items-start gap-3 text-sm font-medium"><Checkbox className="mt-0.5" checked={disclaimer} onCheckedChange={(v) => setDisclaimer(v === true)} />{t("trk.disclaimerAgree")}</label>
          </>
        )}
      </PCard>
      <div className="flex gap-2">
        {step > 0 && <Button variant="outline" className="flex-1" onClick={back} disabled={busy}>{t("trk.back")}</Button>}
        {step < STEPS - 1
          ? <Button className="flex-1" disabled={!valid[step]} onClick={next}>{step === 4 && !meds.length ? t("trk.skip") : t("trk.next")}</Button>
          : <Button className="flex-1" disabled={!valid[step] || busy} onClick={finish}>{t("trk.finish")}</Button>}
      </div>
    </div>
  );
}

function Choice({ on, onClick, children, big }: { on: boolean; onClick: () => void; children: React.ReactNode; big?: boolean }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn("flex min-h-11 w-full items-center justify-center gap-2 rounded-patient border px-3 text-sm transition-colors", big && "min-h-16 justify-start text-base",
        on ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-card hover:bg-accent")}>
      {on && <Check className="size-4 shrink-0" aria-hidden />}{children}
    </button>
  );
}
