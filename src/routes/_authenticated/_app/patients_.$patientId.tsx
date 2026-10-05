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
import { EmptyState } from "@/components/mc/empty-state";
import { Banner } from "@/components/mc/banner";
import { PatientHeader } from "@/components/mc/patient-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMyContext } from "@/hooks/use-my-context";
import { PATIENT_ROLES_EDIT, usePatient } from "@/lib/patients";
import { formatPkr, usePatientSummary } from "@/lib/patient-summary";
import { PATIENT_TABS, tabsForRoles, type PatientTabId } from "@/config/patient-tabs";

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
  const canEdit = PATIENT_ROLES_EDIT.some((r) => hasRole(r));

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
      <EmptyState icon={PATIENT_TABS.find((tb) => tb.id === id)?.icon} title={t(`ptab.empty.${id}`)} description={t("ptab.comingSoon")} />
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
          <Button asChild size="sm"><Link to="/appointments"><CalendarPlus className="size-4" />{t("pat.bookAppointment")}</Link></Button>
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
          {summary.isError && <Banner variant="warning">{t("ptab.summaryUnavailable")}</Banner>}
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
        <TabsContent value="lab">{soon("lab")}</TabsContent>
        <TabsContent value="admissions">{soon("admissions")}</TabsContent>
        <TabsContent value="bills">
          {bills.length === 0 ? soon("bills") : (
            <ul className="divide-y rounded-staff border bg-card">
              {bills.map((b) => (
                <li key={b.id} className="flex justify-between px-4 py-2.5 text-sm">
                  <Ltr>{b.bill_no ?? b.id.slice(0, 8)}</Ltr>
                  <Ltr className="tnum font-semibold text-urgent">{formatPkr(Number(b.balance ?? 0))}</Ltr>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="documents">{soon("documents")}</TabsContent>
      </Tabs>
      <RegistrationSlip patient={x} open={slip} onOpenChange={setSlip} />
    </div>
  );
}
