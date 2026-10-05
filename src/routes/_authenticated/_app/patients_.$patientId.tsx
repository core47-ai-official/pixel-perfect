import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CalendarPlus, Pencil, Printer } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { PatientForm } from "@/components/mc/patient-form";
import { RegistrationSlip } from "@/components/mc/registration-slip";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyContext } from "@/hooks/use-my-context";
import { PATIENT_ROLES_EDIT, ageFrom, usePatient } from "@/lib/patients";

export const Route = createFileRoute("/_authenticated/_app/patients_/$patientId")({
  head: () => ({ meta: [{ title: "Patient — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("patients")}>
      <PatientPage />
    </RequireRole>
  ),
});

function PatientPage() {
  const { patientId } = Route.useParams();
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const qc = useQueryClient();
  const p = usePatient(patientId);
  const [editing, setEditing] = useState(false);
  const [slip, setSlip] = useState(false);
  const canEdit = PATIENT_ROLES_EDIT.some((r) => hasRole(r));

  if (p.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!p.data) return <p className="text-sm text-muted-foreground">{t("pat.notFound")}</p>;
  const x = p.data;

  if (editing) {
    return <PatientForm initial={x} onCancel={() => setEditing(false)}
      onSaved={() => { void qc.invalidateQueries({ queryKey: ["patients"] }); setEditing(false); }} />;
  }

  const age = ageFrom(x.dob);
  const row = (label: string, value: React.ReactNode) => value ? (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1.5 text-sm"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>
  ) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/patients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" />{t("pat.all")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-staff border bg-card p-5">
        <div>
          <h2 className="text-xl font-semibold">{x.full_name}</h2>
          <p className="text-sm text-muted-foreground">
            <Ltr className="font-medium text-foreground">{x.mrn}</Ltr>
            {age !== null && <> · {t("pat.ageYears", { count: age })}</>}
            {x.gender && <> · {t(`doc.genders.${x.gender}`)}</>}
          </p>
          {x.is_unknown && <StatusChip status="warning" className="mt-2">{t("pat.unknownChip")}</StatusChip>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm"><Link to="/appointments"><CalendarPlus className="size-4" />{t("pat.bookAppointment")}</Link></Button>
          <Button size="sm" variant="outline" onClick={() => setSlip(true)}><Printer className="size-4" />{t("pat.printSlip")}</Button>
          {canEdit && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" />{t("dept.editShort")}</Button>}
        </div>
      </div>
      {x.allergies.length > 0 && (
        <div className="rounded-staff border border-urgent bg-urgent-soft/40 p-3 text-sm font-medium">
          {t("pat.allergies")}: <Ltr>{x.allergies.join(", ")}</Ltr>
        </div>
      )}
      <dl className="divide-y rounded-staff border bg-card px-5 py-2">
        {row(t("pat.fatherOrHusband"), x.father_or_husband_name)}
        {row(t("pat.cnic"), x.cnic && <Ltr>{x.cnic}</Ltr>)}
        {row(t("pat.bForm"), x.b_form && <Ltr>{x.b_form}</Ltr>)}
        {row(t("pat.dob"), x.dob && <Ltr>{x.dob}</Ltr>)}
        {row(t("pat.phone"), x.phone && <Ltr>{x.phone}</Ltr>)}
        {row(t("pat.email"), x.email && <Ltr>{x.email}</Ltr>)}
        {row(t("pat.guardianName"), x.guardian_name && <>{x.guardian_name}{x.guardian_phone && <> · <Ltr>{x.guardian_phone}</Ltr></>}</>)}
        {row(t("pat.address"), [x.address, x.tehsil, x.district, x.province && t(`pat.provinces.${x.province}`)].filter(Boolean).join(", "))}
        {row(t("pat.bloodGroup"), x.blood_group && <Ltr>{x.blood_group}</Ltr>)}
        {row(t("pat.chronic"), x.chronic_conditions.join(", "))}
        {row(t("pat.pregnancy"), x.pregnancy_status && t(`pat.preg.${x.pregnancy_status}`))}
        {row(t("pat.printLanguage"), x.print_language === "ur" ? t("pat.urdu") : t("pat.englishOnly"))}
      </dl>
      <RegistrationSlip patient={x} open={slip} onOpenChange={setSlip} />
    </div>
  );
}
