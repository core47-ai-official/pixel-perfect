import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { CnicInput, PhoneInput } from "@/components/mc/masked-input";
import { Ltr } from "@/components/mc/ltr";
import { Banner } from "@/components/mc/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import {
  BLOOD_GROUPS, GENDERS, PREGNANCY, PROVINCES, ageFrom, type DuplicateMatch, type Patient, type PatientInput,
} from "@/lib/patients";

const EMPTY: PatientInput = {
  cnic: null, b_form: null, full_name: "", father_or_husband_name: null, dob: null, gender: null, phone: null, email: null,
  guardian_name: null, guardian_phone: null, province: null, district: null, tehsil: null, address: null, blood_group: null,
  allergies: [], chronic_conditions: [], pregnancy_status: null, print_language: null, is_unknown: false,
};
const cnicOk = (v: string) => !v || v.replace(/\D/g, "").length === 13;
const phoneOk = (v: string) => !v || /^3\d{9}$/.test(v.replace(/\D/g, "").replace(/^92/, "").replace(/^0/, ""));
const NONE = "__none";

/** Single-column registration/edit form. Checks for duplicates before saving a new patient. */
export function PatientForm({
  initial, onSaved, onUseExisting, onCancel,
}: {
  initial?: Patient;
  onSaved: (p: Patient) => void;
  onUseExisting?: (id: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [f, setF] = useState<PatientInput>(initial ? { ...EMPTY, ...initial } : EMPTY);
  const [allergies, setAllergies] = useState((initial?.allergies ?? []).join(", "));
  const [chronic, setChronic] = useState((initial?.chronic_conditions ?? []).join(", "));
  const [dupes, setDupes] = useState<DuplicateMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PatientInput>(k: K, v: PatientInput[K]) => { setF((p) => ({ ...p, [k]: v })); setDupes(null); };
  const s = (v: string | null) => v ?? "";
  const n = (v: string) => (v.trim() ? v : null);

  const validate = () => {
    if (f.full_name.trim().length < 2) return t("pat.err.name");
    if (!f.is_unknown && !f.gender) return t("pat.err.gender");
    if (!f.is_unknown && !f.dob) return t("pat.err.dob");
    if (f.dob && f.dob > new Date().toISOString().slice(0, 10)) return t("pat.err.dobFuture");
    if (!cnicOk(s(f.cnic))) return t("pat.err.cnic");
    if (!cnicOk(s(f.b_form))) return t("pat.err.bform");
    if (!phoneOk(s(f.phone)) || !phoneOk(s(f.guardian_phone))) return t("pat.err.phone");
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return t("pat.err.email");
    if (f.pregnancy_status === "pregnant" && f.gender === "male") return t("pat.err.preg");
    return null;
  };

  const payload = () => ({
    ...f,
    full_name: f.full_name.trim(),
    allergies: allergies.split(",").map((x) => x.trim()).filter(Boolean),
    chronic_conditions: chronic.split(",").map((x) => x.trim()).filter(Boolean),
  });

  const save = async (confirmDuplicate: boolean) => {
    setBusy(true);
    try {
      const fn = initial ? "update-patient" : "register-patient";
      const body = initial ? { id: initial.id, ...payload(), confirm_duplicate: confirmDuplicate } : { ...payload(), confirm_duplicate: confirmDuplicate };
      const saved = await callEdgeFunction<Patient>(fn, body);
      toast.success(initial ? t("pat.updated") : t("pat.registered", { mrn: saved.mrn }));
      onSaved(saved);
    } catch (e) {
      const err = e as EdgeError;
      if (err.code === "duplicate" && !dupes) await check(true);
      toast.error(err.message || t("errors.generic"));
    } finally { setBusy(false); }
  };

  async function check(force = false) {
    const res = await callEdgeFunction<{ matches: DuplicateMatch[] }>("check-patient-duplicates", {
      cnic: f.cnic, phone: f.phone, full_name: f.full_name, dob: f.dob, exclude_id: initial?.id,
    });
    setDupes(res.matches);
    return force ? res.matches : res.matches;
  }

  const submit = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    if (dupes === null) {
      setBusy(true);
      try {
        const m = await check();
        if (m.length > 0) { setBusy(false); return; } // show warnings first
      } catch (e) {
        toast.error((e as EdgeError).message || t("errors.generic")); setBusy(false); return;
      }
      setBusy(false);
    }
    await save((dupes ?? []).length > 0);
  };

  const field = (id: string, label: string, el: React.ReactNode, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {el}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  const pick = (id: keyof PatientInput, opts: readonly string[], label: (v: string) => string, placeholder = "—") => (
    <Select value={(f[id] as string | null) ?? NONE} onValueChange={(v) => set(id, (v === NONE ? null : v) as never)}>
      <SelectTrigger id={id}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {opts.map((o) => <SelectItem key={o} value={o}>{label(o)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  const section = (title: string, children: React.ReactNode) => (
    <fieldset className="space-y-4 rounded-staff border bg-card p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
  const age = ageFrom(f.dob);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {section(t("pat.s.identity"), <>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={f.is_unknown} onCheckedChange={(c) => set("is_unknown", c === true)} />
          {t("pat.isUnknown")}
        </label>
        {field("full_name", t("pat.fullName"), <Input id="full_name" value={f.full_name} maxLength={120} onChange={(e) => set("full_name", e.target.value)} />)}
        {field("father", t("pat.fatherOrHusband"), <Input id="father" value={s(f.father_or_husband_name)} maxLength={120} onChange={(e) => set("father_or_husband_name", n(e.target.value))} />)}
        {field("cnic", t("pat.cnic"), <CnicInput id="cnic" value={s(f.cnic)} onValueChange={(v) => set("cnic", n(v))} />, t("pat.cnicHint"))}
        {field("b_form", t("pat.bForm"), <CnicInput id="b_form" value={s(f.b_form)} onValueChange={(v) => set("b_form", n(v))} />, t("pat.bFormHint"))}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("dob", t("pat.dob"), <Input id="dob" type="date" dir="ltr" max={new Date().toISOString().slice(0, 10)} value={s(f.dob)} onChange={(e) => set("dob", n(e.target.value))} />,
            age !== null ? t("pat.ageYears", { count: age }) : undefined)}
          {field("gender", t("pat.gender"), pick("gender", GENDERS, (v) => t(`doc.genders.${v}`)))}
        </div>
      </>)}

      {section(t("pat.s.contact"), <>
        {field("phone", t("pat.phone"), <PhoneInput id="phone" value={s(f.phone)} onValueChange={(v) => set("phone", n(v))} />)}
        {field("email", t("pat.email"), <Input id="email" type="email" dir="ltr" maxLength={255} value={s(f.email)} onChange={(e) => set("email", n(e.target.value))} />)}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("gname", t("pat.guardianName"), <Input id="gname" value={s(f.guardian_name)} maxLength={120} onChange={(e) => set("guardian_name", n(e.target.value))} />)}
          {field("gphone", t("pat.guardianPhone"), <PhoneInput id="gphone" value={s(f.guardian_phone)} onValueChange={(v) => set("guardian_phone", n(v))} />)}
        </div>
      </>)}

      {section(t("pat.s.address"), <>
        {field("province", t("pat.province"), pick("province", PROVINCES, (v) => t(`pat.provinces.${v}`)))}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("district", t("pat.district"), <Input id="district" value={s(f.district)} maxLength={60} onChange={(e) => set("district", n(e.target.value))} />)}
          {field("tehsil", t("pat.tehsil"), <Input id="tehsil" value={s(f.tehsil)} maxLength={60} onChange={(e) => set("tehsil", n(e.target.value))} />)}
        </div>
        {field("address", t("pat.address"), <Textarea id="address" value={s(f.address)} maxLength={300} onChange={(e) => set("address", n(e.target.value))} />)}
      </>)}

      {section(t("pat.s.medical"), <>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("blood", t("pat.bloodGroup"), pick("blood_group", BLOOD_GROUPS, (v) => v))}
          {f.gender !== "male" && field("preg", t("pat.pregnancy"), pick("pregnancy_status", PREGNANCY, (v) => t(`pat.preg.${v}`)))}
        </div>
        {field("allergies", t("pat.allergies"), <Input id="allergies" value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder={t("pat.commaHint")} />)}
        {field("chronic", t("pat.chronic"), <Input id="chronic" value={chronic} onChange={(e) => setChronic(e.target.value)} placeholder={t("pat.commaHint")} />)}
      </>)}

      {section(t("pat.s.print"), field("pl", t("pat.printLanguage"), pick("print_language", ["ur"], () => t("pat.urdu"), t("pat.englishOnly")), t("pat.printLanguageHint")))}

      {dupes && dupes.length > 0 && (
        <div className="space-y-3" role="alert">
          <Banner tone="warning" title={t("pat.dupTitle", { count: dupes.length })}>{t("pat.dupBody")}</Banner>
          {dupes.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-staff border border-caution bg-caution-soft/40 p-3">
              <div className="min-w-0 text-sm">
                <div className="font-semibold">{d.full_name} <Ltr className="ms-1 text-xs text-muted-foreground">{d.mrn}</Ltr></div>
                <div className="text-xs text-muted-foreground">
                  {[d.father_or_husband_name, d.dob && <Ltr key="d">{d.dob}</Ltr>, d.cnic && <Ltr key="c">{d.cnic}</Ltr>, d.phone && <Ltr key="p">{d.phone}</Ltr>, d.district]
                    .filter(Boolean).map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}
                </div>
                <div className="mt-1 flex items-center gap-1 text-xs font-medium">
                  <AlertTriangle className="size-3.5" />{d.reasons.map((r) => t(`pat.reason.${r}`)).join(", ")}
                </div>
              </div>
              {onUseExisting && <Button size="sm" onClick={() => onUseExisting(d.id)}>{t("pat.useThis")}</Button>}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button variant="outline" onClick={onCancel}>{t("dept.cancel")}</Button>}
        <Button onClick={submit} disabled={busy} variant={dupes && dupes.length ? "outline" : "default"}>
          {dupes && dupes.length ? t("pat.saveAnyway") : initial ? t("dept.save") : t("pat.register")}
        </Button>
      </div>
    </div>
  );
}
