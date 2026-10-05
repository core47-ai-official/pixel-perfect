import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarPlus, CheckCircle2, Printer, UserPlus } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { PatientForm } from "@/components/mc/patient-form";
import { RegistrationSlip } from "@/components/mc/registration-slip";
import { Ltr } from "@/components/mc/ltr";
import { BookAppointmentPanel } from "@/components/mc/book-appointment-panel";
import { Button } from "@/components/ui/button";
import { PATIENT_ROLES_EDIT, type Patient } from "@/lib/patients";

export const Route = createFileRoute("/_authenticated/_app/patients_/new")({
  head: () => ({ meta: [{ title: "Register patient — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={[...PATIENT_ROLES_EDIT]}>
      <NewPatient />
    </RequireRole>
  ),
});

function NewPatient() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [saved, setSaved] = useState<Patient | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [slip, setSlip] = useState(false);
  const [booking, setBooking] = useState(false);

  if (saved) {
    return (
      <div className="mx-auto max-w-lg space-y-5 rounded-staff border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto size-12 text-ok" />
        <div>
          <h2 className="text-xl font-semibold">{t("pat.doneTitle", { name: saved.full_name })}</h2>
          <p className="mt-1 text-muted-foreground">{t("pat.mrnLabel")}: <Ltr className="font-semibold text-foreground">{saved.mrn}</Ltr></p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={() => setBooking(true)}><CalendarPlus className="size-4" />{t("pat.bookAppointment")}</Button>
          <Button variant="outline" onClick={() => setSlip(true)}><Printer className="size-4" />{t("pat.printSlip")}</Button>
        </div>
        <div className="flex justify-center gap-4 text-sm">
          <Link to="/patients/$patientId" params={{ patientId: saved.id }} className="text-primary hover:underline">{t("pat.openRecord")}</Link>
          <button className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => { setSaved(null); setFormKey((k) => k + 1); }}>
            <UserPlus className="size-4" />{t("pat.registerAnother")}
          </button>
        </div>
        <RegistrationSlip patient={saved} open={slip} onOpenChange={setSlip} />
        <BookAppointmentPanel open={booking} onOpenChange={setBooking} patientId={saved.id} />
      </div>
    );
  }

  return (
    <PatientForm
      key={formKey}
      onSaved={(p) => { void qc.invalidateQueries({ queryKey: ["patients"] }); setSaved(p); }}
      onUseExisting={(id) => navigate({ to: "/patients/$patientId", params: { patientId: id } })}
      onCancel={() => navigate({ to: "/patients" })}
    />
  );
}
