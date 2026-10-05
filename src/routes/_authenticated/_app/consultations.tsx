import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Banner } from "@/components/mc/banner";
import { EmptyState } from "@/components/mc/empty-state";
import { Ltr } from "@/components/mc/ltr";
import { useMyContext } from "@/hooks/use-my-context";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useDepartmentsData } from "@/lib/departments-data";
import { pkTime, useDayAppointments } from "@/lib/appointments";
import { useMyDraftVisits, type Visit } from "@/lib/visits";

export const Route = createFileRoute("/_authenticated/_app/consultations")({
  head: () => ({
    meta: [
      { title: "Consultations — MediCore HMS" },
      { name: "description", content: "Start and continue consultation notes for today's patients." },
    ],
  }),
  component: () => (
    <RequireRole roles={rolesForPage("consultations")}>
      <Consultations />
    </RequireRole>
  ),
});

const todayPk = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

function Consultations() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { context } = useMyContext();
  const { doctors } = useDepartmentsData();
  const me = (doctors.data ?? []).find((d) => d.user_id === context?.profile?.id);
  const appts = useDayAppointments(todayPk());
  const drafts = useMyDraftVisits(me?.id);
  const [busy, setBusy] = useState<string | null>(null);

  if (doctors.isLoading) return <Skeleton className="h-64" />;
  if (!me) return <Banner tone="warning" title={t("myday.notDoctor")} />;

  const mine = (appts.data ?? []).filter((a) => a.doctor_id === me.id && ["booked", "waiting", "in_consultation", "done"].includes(a.status))
    .sort((a, b) => (a.token_no ?? 0) - (b.token_no ?? 0));

  const start = async (appointmentId: string) => {
    setBusy(appointmentId);
    try {
      const v = await callEdgeFunction<Visit>("start-consultation", { appointment_id: appointmentId });
      void navigate({ to: "/consultations/$visitId", params: { visitId: v.id } });
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? t("errors.generic"));
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("consult.title")}</h1>
      {(drafts.data ?? []).length > 0 && (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-2 font-semibold">{t("consult.drafts")}</h2>
          <ul className="divide-y">
            {drafts.data!.map((v) => (
              <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1">{v.patients?.full_name} <Ltr className="text-xs text-muted-foreground">{v.patients?.mrn}</Ltr></span>
                <Button size="sm" variant="outline" asChild><Link to="/consultations/$visitId" params={{ visitId: v.id }}>{t("consult.open")}</Link></Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 font-semibold">{t("consult.todayList")}</h2>
        {appts.isLoading ? <Skeleton className="h-32" /> : mine.length === 0 ? <EmptyState title={t("consult.none")} /> : (
          <ul className="divide-y">
            {mine.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                <Ltr className="w-8 text-lg font-semibold">{a.token_no}</Ltr>
                <Ltr className="w-12 text-muted-foreground">{pkTime(a.slot_start)}</Ltr>
                <span className="flex-1 truncate">{a.patients?.full_name}</span>
                <span className="text-xs text-muted-foreground">{t(`appt.statuses.${a.status}`, { defaultValue: a.status })}</span>
                <Button size="sm" variant={a.status === "done" ? "outline" : "default"} disabled={busy === a.id} onClick={() => start(a.id)}>
                  {a.status === "done" || a.status === "in_consultation" ? t("consult.open") : t("consult.start")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
