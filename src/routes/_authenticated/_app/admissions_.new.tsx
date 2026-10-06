import { formatPkr } from "@/lib/patient-summary";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { z } from "zod";
import { RequireRole } from "@/components/mc/require-role";
import { Ltr } from "@/components/mc/ltr";
import { PatientPicker } from "@/components/mc/book-appointment-panel";
import { BedPicker } from "@/components/mc/bed-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { supabase } from "@/integrations/supabase/client";
import { useBookableDoctors } from "@/lib/appointments";
import { useBeds, useWards } from "@/lib/beds";
import { ADMISSION_INVALIDATE } from "@/lib/admissions";
import { cn } from "@/lib/utils";

export const ADMIT_ROLES = ["super_admin", "admin", "dept_head", "doctor", "er_officer", "receptionist", "nurse"] as const;

export const Route = createFileRoute("/_authenticated/_app/admissions_/new")({
  validateSearch: z.object({ patient: z.string().optional(), request: z.string().optional() }),
  head: () => ({ meta: [{ title: "Admit patient — MediCore HMS" }, { name: "description", content: "Admission wizard: patient, bed, doctor, reason and deposit." }] }),
  component: () => (
    <RequireRole roles={[...ADMIT_ROLES]}>
      <AdmitWizard />
    </RequireRole>
  ),
});

type P = { id: string; full_name: string; mrn: string; gender: string | null };

function AdmitWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [step, setStep] = useState(0);
  const [patient, setPatient] = useState<P | null>(null);
  const [bed, setBed] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<string>("");
  const [reason, setReason] = useState("");
  const [deposit, setDeposit] = useState("");
  const doctors = useBookableDoctors();
  const beds = useBeds();
  const wards = useWards();
  const request = useQuery({
    queryKey: ["bed-request", search.request], enabled: !!search.request,
    queryFn: async () => (await supabase.from("bed_requests" as never).select("*").eq("id", search.request!).maybeSingle()).data as unknown as { id: string; patient_id: string; bed_id: string | null; bed_class: string; doctor_id: string | null; note: string } | null,
  });
  const pid = search.patient ?? request.data?.patient_id;
  useEffect(() => {
    if (!pid) return;
    void supabase.from("patients").select("id, full_name, mrn, gender").eq("id", pid).maybeSingle().then(({ data }) => { if (data) { setPatient(data as P); setStep(1); } });
  }, [pid]);
  useEffect(() => {
    if (!request.data) return;
    if (request.data.bed_id) setBed(request.data.bed_id);
    if (request.data.doctor_id) setDoctor(request.data.doctor_id);
    if (request.data.note) setReason((r) => r || request.data!.note);
  }, [request.data]);
  // Changing patient resets the bed choice (gender rule).
  const pickPatient = async (p: { id: string; full_name: string; mrn: string }) => {
    const { data } = await supabase.from("patients").select("gender").eq("id", p.id).maybeSingle();
    setPatient({ ...p, gender: (data as { gender: string | null } | null)?.gender ?? null }); setBed(null); setStep(1);
  };
  const admit = useEdgeFunction("admit-patient", { invalidate: ADMISSION_INVALIDATE, successMessage: t("adm.admitted") });
  const chosenBed = (beds.data ?? []).find((b) => b.id === bed);
  const chosenWard = (wards.data ?? []).find((w) => w.id === chosenBed?.ward_id);
  const doc = (doctors.data ?? []).find((d) => d.id === doctor);
  const submit = async () => {
    if (!patient || !bed || !doctor || reason.trim().length < 3) { toast.error(t("wd.required")); return; }
    try {
      const res = (await admit.mutateAsync({ patient_id: patient.id, bed_id: bed, doctor_id: doctor, reason, deposit_amount: Number(deposit || 0), request_id: search.request })) as { coverage?: { programme: string; remaining: number } | null } | undefined;
      if (res?.coverage) toast.info(t("ent.admittedOnCard", { programme: res.coverage.programme, remaining: formatPkr(res.coverage.remaining) }));
      void navigate({ to: "/patients/$patientId", params: { patientId: patient.id } });
    } catch { /* shown */ }
  };
  const steps = [t("adm.steps.patient"), t("adm.steps.bed"), t("adm.steps.details"), t("adm.steps.confirm")];
  const canNext = [!!patient, !!bed, !!doctor && reason.trim().length >= 3, true][step];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ol className="flex gap-2">
        {steps.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2 text-sm">
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", i < step ? "border-primary bg-primary text-primary-foreground" : i === step ? "border-primary text-primary" : "text-muted-foreground")}>
              {i < step ? <Check className="size-4" /> : <Ltr>{i + 1}</Ltr>}
            </span>
            <span className={cn("hidden sm:inline", i !== step && "text-muted-foreground")}>{s}</span>
          </li>
        ))}
      </ol>

      <div className="rounded-lg border bg-card p-4">
        {step === 0 && (
          <div className="space-y-3">
            <Label>{t("adm.steps.patient")}</Label>
            <PatientPicker onPick={(p) => void pickPatient(p)} />
          </div>
        )}
        {step > 0 && patient && <p className="mb-4 text-sm">{patient.full_name} · <Ltr>{patient.mrn}</Ltr>{patient.gender && <> · {t(`wd.genders.${patient.gender}`, patient.gender)}</>}</p>}
        {step === 1 && patient && (
          <BedPicker patientGender={patient.gender} value={bed} onChange={setBed} allowReservedId={request.data?.bed_id} initialClass={request.data?.bed_class} />
        )}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>{t("adm.doctor")}</Label>
              <Select value={doctor} onValueChange={setDoctor}><SelectTrigger><SelectValue placeholder={t("adm.pickDoctor")} /></SelectTrigger>
                <SelectContent>{(doctors.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name} · {d.specialty}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="ad-reason">{t("adm.reason")}</Label>
              <Textarea id="ad-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="ad-dep">{t("adm.deposit")}</Label>
              <Input id="ad-dep" dir="ltr" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/[^\d.]/g, ""))} />
              <p className="text-xs text-muted-foreground">{t("adm.depositNote")}</p></div>
          </div>
        )}
        {step === 3 && (
          <dl className="divide-y text-sm">
            {[
              [t("adm.bed"), <span key="b"><Ltr className="font-mono font-semibold">{chosenBed?.label}</Ltr> · {chosenWard?.name} · <Ltr>Rs {chosenBed?.daily_rate.toLocaleString("en-PK")}</Ltr>/{t("adm.day")}</span>],
              [t("adm.doctor"), doc?.full_name ?? "—"],
              [t("adm.reason"), reason],
              [t("adm.deposit"), <Ltr key="d">Rs {Number(deposit || 0).toLocaleString("en-PK")}</Ltr>],
            ].map(([k, v], i) => <div key={i} className="flex justify-between gap-4 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="text-end">{v}</dd></div>)}
          </dl>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>{t("adm.back")}</Button>
        {step < 3 ? <Button disabled={!canNext} onClick={() => setStep(step + 1)}>{t("adm.next")}</Button>
          : <Button onClick={submit} disabled={admit.isPending}>{t("adm.admit")}</Button>}
      </div>
    </div>
  );
}
