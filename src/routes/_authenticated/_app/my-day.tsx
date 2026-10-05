import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BedDouble, FlaskConical, Megaphone } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Banner } from "@/components/mc/banner";
import { EmptyState } from "@/components/mc/empty-state";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { useMyContext } from "@/hooks/use-my-context";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useDepartmentsData } from "@/lib/departments-data";
import { pkTime, useAppointmentsRealtime, useDayAppointments } from "@/lib/appointments";

export const Route = createFileRoute("/_authenticated/_app/my-day")({
  head: () => ({
    meta: [
      { title: "My day — MediCore HMS" },
      { name: "description", content: "Your queue, today's appointments and patients at a glance." },
    ],
  }),
  component: () => (
    <RequireRole roles={rolesForPage("myDay")}>
      <MyDay />
    </RequireRole>
  ),
});

const TONE: Record<string, "progress" | "caution" | "warning" | "ok" | "urgent" | "inactive"> = {
  booked: "progress", waiting: "caution", in_consultation: "warning", done: "ok", needs_rebooking: "urgent", no_show: "inactive", cancelled: "inactive",
};
const todayPk = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

function MyDay() {
  const { t } = useTranslation();
  const { context } = useMyContext();
  useAppointmentsRealtime(context?.hospital?.id);
  const { doctors } = useDepartmentsData();
  const me = (doctors.data ?? []).find((d) => d.user_id === context?.profile?.id);
  const appts = useDayAppointments(todayPk());
  const [busy, setBusy] = useState(false);

  if (doctors.isLoading) return <Skeleton className="h-64" />;
  if (!me) return <Banner tone="warning">{t("myday.notDoctor")}</Banner>;

  const mine = (appts.data ?? []).filter((a) => a.doctor_id === me.id && a.status !== "cancelled");
  const current = mine.find((a) => a.status === "in_consultation");
  const waiting = mine.filter((a) => a.status === "waiting").sort((a, b) => (a.token_no ?? 0) - (b.token_no ?? 0));

  const callNext = async () => {
    setBusy(true);
    try {
      const d = await callEdgeFunction<{ token_no: number } | null>("call-next-token", {});
      toast.success(d ? t("queue.called", { token: d.token_no }) : t("queue.queueEmpty"));
      await appts.refetch();
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? t("errors.generic"));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("myday.title")}</h1>
        <Button onClick={callNext} disabled={busy}><Megaphone className="size-4" />{t("queue.callNext")}</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border bg-card p-4 lg:col-span-1">
          <h2 className="mb-3 font-semibold">{t("myday.myQueue")}</h2>
          <div className="mb-3 rounded-md bg-primary/10 p-3">
            <p className="text-xs text-muted-foreground">{t("myday.inConsult")}</p>
            {current ? (
              <Link to="/patients/$patientId" params={{ patientId: current.patient_id }} className="flex items-baseline gap-3">
                <Ltr className="text-3xl font-bold text-primary">{current.token_no}</Ltr>
                <span className="font-medium hover:underline">{current.patients?.full_name}</span>
              </Link>
            ) : <p className="text-2xl font-bold text-muted-foreground">—</p>}
          </div>
          <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">{t("myday.waiting")} · <Ltr>{waiting.length}</Ltr></p>
          {waiting.length === 0 ? <p className="text-sm text-muted-foreground">{t("queue.queueEmpty")}</p> : (
            <ul className="divide-y">
              {waiting.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                  <Ltr className="w-8 text-lg font-semibold">{a.token_no}</Ltr>
                  <span className="flex-1 truncate">{a.patients?.full_name}</span>
                  <Ltr className="text-xs text-muted-foreground">{a.patients?.mrn}</Ltr>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4 lg:col-span-2">
          <h2 className="mb-3 font-semibold">{t("myday.today")}</h2>
          {appts.isLoading ? <Skeleton className="h-40" /> : mine.length === 0 ? <EmptyState title={t("myday.noneToday")} /> : (
            <ul className="divide-y">
              {mine.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                  <Ltr className="w-12 text-muted-foreground">{pkTime(a.slot_start)}</Ltr>
                  <Ltr className="w-8 font-medium">{a.token_no}</Ltr>
                  <Link to="/patients/$patientId" params={{ patientId: a.patient_id }} className="flex-1 truncate hover:underline">{a.patients?.full_name}</Link>
                  <span className="hidden text-muted-foreground sm:inline">{t(`appt.types.${a.type}`, { defaultValue: a.type })}</span>
                  <StatusChip status={TONE[a.status] ?? "inactive"}>{t(`appt.status.${a.status}`, { defaultValue: a.status })}</StatusChip>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold"><BedDouble className="size-4" />{t("myday.admitted")}</h2>
          <p className="text-sm text-muted-foreground">{t("myday.comingSoon")}</p>
        </section>
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold"><FlaskConical className="size-4" />{t("myday.critical")}</h2>
          <p className="text-sm text-muted-foreground">{t("myday.comingSoon")}</p>
        </section>
      </div>
    </div>
  );
}
