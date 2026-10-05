import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CalendarPlus, Pencil, Printer } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { PatientForm } from "@/components/mc/patient-form";
import { RegistrationSlip } from "@/components/mc/registration-slip";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { EmptyState } from "@/components/mc/empty-state";
import { PatientLabTab } from "@/components/mc/patient-lab-tab";
import { Banner } from "@/components/mc/banner";
import { PatientHeader } from "@/components/mc/patient-header";
import { BookAppointmentPanel } from "@/components/mc/book-appointment-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMyContext } from "@/hooks/use-my-context";
import { PATIENT_ROLES_EDIT, usePatient } from "@/lib/patients";
import { PatientAdmissionsTab } from "@/components/mc/patient-admissions-tab";
import { PatientBillsTab } from "@/components/mc/patient-bills-tab";
import { PatientMarHistory } from "@/components/mc/mar-grid";
import { formatPkr, usePatientSummary } from "@/lib/patient-summary";
import { PATIENT_TABS, TAB_ICON_FALLBACK, tabsForRoles, type PatientTabId } from "@/config/patient-tabs";

export const Route = createFileRoute("/_authenticated/_app/patients_/$patientId")({
  head: () => ({ meta: [{ title: "Patient profile — MediCore HMS" }, { name: "description", content: "Patient profile with visits, prescriptions, lab, admissions, bills and documents." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("patients")}>
      <PatientPage />
    </RequireRole>
  ),
});

function PatientPage() {
  const { patientId } = Route.useParams();
  const { t } = useTranslation();
  const { hasRole, context } = useMyContext();
  const roles = context?.roles ?? [];
  const qc = useQueryClient();
  const p = usePatient(patientId);
  const summary = usePatientSummary(patientId);
  const [editing, setEditing] = useState(false);
  const [slip, setSlip] = useState(false);
  const [booking, setBooking] = useState(false);
  const canEdit = PATIENT_ROLES_EDIT.some((r) => hasRole(r));
  const isDeptHead = roles.includes("dept_head");
  // Department heads opening a record outside their own list are audit-logged (decided server-side).
  useEffect(() => {
    if (isDeptHead) void callEdgeFunction("log-record-view", { patient_id: patientId }).catch(() => undefined);
  }, [isDeptHead, patientId]);

  if (p.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!p.data) return <p className="text-sm text-muted-foreground">{t("pat.notFound")}</p>;
  const x = p.data;

  if (editing) {
    return <PatientForm initial={x} onCancel={() => setEditing(false)}
      onSaved={() => { void qc.invalidateQueries({ queryKey: ["patients"] }); setEditing(false); }} />;
  }

  const tabs = tabsForRoles(roles);
  const visits = summary.data?.recent_visits ?? [];
  const bills = summary.data?.open_bills ?? [];
  const admission = summary.data?.active_admission;
  const row = (label: string, value: React.ReactNode) => value ? (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1.5 text-sm"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>
  ) : null;
  const soon = (id: PatientTabId) => (
    <div className="rounded-staff border bg-card">
      <EmptyState icon={PATIENT_TABS.find((tb) => tb.id === id)?.icon ?? TAB_ICON_FALLBACK} title={t(`ptab.empty.${id}`)} description={t("ptab.comingSoon")} />
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link to="/patients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" />{t("pat.all")}
      </Link>
      <PatientHeader patientId={patientId} />
      <div className="flex flex-wrap items-center gap-2">
        {x.is_unknown && <StatusChip status="warning">{t("pat.unknownChip")}</StatusChip>}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setBooking(true)}><CalendarPlus className="size-4" />{t("pat.bookAppointment")}</Button>
          <Button size="sm" variant="outline" onClick={() => setSlip(true)}><Printer className="size-4" />{t("pat.printSlip")}</Button>
          {canEdit && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" />{t("dept.editShort")}</Button>}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="h-auto flex-wrap justify-start">
          {tabs.map((tb) => (
            <TabsTrigger key={tb.id} value={tb.id} className="gap-1.5"><tb.icon className="size-4" />{t(`ptab.${tb.id}`)}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {summary.isError && <Banner tone="warning" title={t("ptab.summaryUnavailable")} />}
          {admission && (
            <div className="rounded-staff border border-progress bg-progress-soft/40 p-3 text-sm">
              {t("ptab.activeAdmission")}{admission.ward && <> · {admission.ward}</>}{admission.bed && <> · <Ltr>{admission.bed}</Ltr></>}
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
        </TabsContent>

        <TabsContent value="visits">
          {visits.length === 0 ? soon("visits") : (
            <ul className="divide-y rounded-staff border bg-card">
              {visits.map((v) => (
                <li key={v.id} className="flex justify-between px-4 py-2.5 text-sm">
                  <Ltr>{v.visit_date ?? ""}</Ltr><span className="text-muted-foreground">{v.type} {v.status && `· ${v.status}`}</span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="prescriptions">{soon("prescriptions")}</TabsContent>
        <TabsContent value="lab"><PatientLabTab patientId={patientId} /></TabsContent>
        <TabsContent value="admissions" className="space-y-6"><PatientAdmissionsTab patient={{ id: patientId, full_name: x.full_name, gender: x.gender, mrn: x.mrn, print_language: x.print_language }} /><PatientMarHistory patientId={patientId} /></TabsContent>
        <TabsContent value="bills"><PatientBillsTab patientId={patientId} /></TabsContent>
        <TabsContent value="documents">{soon("documents")}</TabsContent>
      </Tabs>
      <RegistrationSlip patient={x} open={slip} onOpenChange={setSlip} />
      <BookAppointmentPanel open={booking} onOpenChange={setBooking} patientId={x.id} />
    </div>
  );
}
