import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { HeartPulse, Pill, Phone, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimelineView, TrackerToday, TrendsView } from "@/components/mc/tracker-views";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { SymptomSection } from "@/components/mc/symptom-log";
import { RecentMeasurements } from "@/components/mc/recent-measurements";
import { QuickAddMeasurements } from "@/components/mc/measurement-sheet";
import { TrackerOnboarding } from "@/components/mc/tracker-onboarding";
import { bmi, useTrackerLists, useTrackerProfile, type TrackerProfile } from "@/lib/tracker";

export const Route = createFileRoute("/_authenticated/portal/health")({
  head: () => ({ meta: [
    { title: "Health tracker — Patient portal" },
    { name: "description", content: "Your private health tracker: conditions, medicines and measurements." },
    { property: "og:title", content: "Health tracker — Patient portal" },
    { property: "og:description", content: "Your private health tracker." },
  ] }),
  component: HealthPage,
});

function HealthPage() {
  const { t } = useTranslation();
  const p = useTrackerProfile();
  if (p.isLoading) return <Skeleton className="h-72 rounded-patient" />;
  if (p.isError) return <Banner tone="danger" title={t("trk.loadFailed")} />;
  if (!p.data?.onboarding_done) return <TrackerOnboarding />;
  return <Dashboard profile={p.data} />;
}

function Dashboard({ profile }: { profile: TrackerProfile }) {
  const { t } = useTranslation();
  const lists = useTrackerLists();
  const b = bmi(profile.height_cm, profile.weight_kg);
  const ec = profile.emergency_contact ?? {};
  return (
    <div className="space-y-4" data-testid="tracker-dashboard">
      <Tabs defaultValue="today">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="today">{t("trd.tab_today")}</TabsTrigger>
          <TabsTrigger value="trends">{t("trd.tab_trends")}</TabsTrigger>
          <TabsTrigger value="timeline">{t("trd.tab_timeline")}</TabsTrigger>
        </TabsList>
        <TabsContent value="trends" className="mt-4"><TrendsView /></TabsContent>
        <TabsContent value="timeline" className="mt-4"><TimelineView /></TabsContent>
        <TabsContent value="today" className="mt-4 space-y-4">
      <TrackerToday />
      <QuickAddMeasurements />
      <RecentMeasurements />
      <SymptomSection />
      <div className="grid grid-cols-3 gap-2">
        {[[t("trk.height"), profile.height_cm ? `${profile.height_cm} cm` : "—"], [t("trk.weight"), profile.weight_kg ? `${profile.weight_kg} kg` : "—"], ["BMI", b ? b.toFixed(1) : "—"]].map(([k, v]) => (
          <PCard key={k} className="p-3 text-center"><p className="text-xs text-muted-foreground">{k}</p><Ltr className="text-lg font-semibold">{v}</Ltr></PCard>
        ))}
      </div>
      <PCard>
        <p className="mb-2 flex items-center gap-2 font-medium"><HeartPulse className="size-4" aria-hidden />{t("trk.conditions")}</p>
        {lists.data?.conditions.length ? (
          <ul className="flex flex-wrap gap-2">{lists.data.conditions.map((c) => <li key={c.id} className="rounded-full bg-accent px-3 py-1 text-sm"><Ltr>{c.name}</Ltr></li>)}</ul>
        ) : <p className="text-sm text-muted-foreground">{t("trk.noConditions")}</p>}
      </PCard>
      <Link to="/portal/doctors" className="block"><PCard className="flex items-center justify-between gap-2"><span className="font-medium">{t("conn.title")}</span><span className="text-sm font-medium text-primary">{t("conn.manage")}</span></PCard></Link>
      <PCard>
        <div className="mb-2 flex items-center justify-between gap-2"><p className="flex items-center gap-2 font-medium"><Pill className="size-4" aria-hidden />{t("trk.medicines")}</p><Link to="/portal/medicines" className="text-sm font-medium text-primary">{t("meds.open")}</Link></div>
        {lists.data?.medicines.length ? (
          <ul className="divide-y">{lists.data.medicines.map((m) => <li key={m.id} className="flex justify-between py-1.5 text-sm"><Ltr className="font-medium">{m.name}</Ltr><Ltr className="text-muted-foreground">{m.dose ?? ""}</Ltr></li>)}</ul>
        ) : <p className="text-sm text-muted-foreground">{t("trk.noMedicines")}</p>}
      </PCard>
      <PCard className="space-y-1">
        <p className="flex items-center gap-2 font-medium"><Phone className="size-4" aria-hidden />{t("trk.emergencyContact")}</p>
        <p className="text-sm">{ec.name || "—"}{ec.relation ? ` · ${ec.relation}` : ""} {ec.phone && <Ltr>{ec.phone}</Ltr>}</p>
        {profile.blood_group && <p className="text-sm text-muted-foreground">{t("trk.bloodGroup")}: <Ltr>{profile.blood_group}</Ltr></p>}
      </PCard>
      <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />{t("trk.privateNote")}</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
