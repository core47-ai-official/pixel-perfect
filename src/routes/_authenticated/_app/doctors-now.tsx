import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { StatusChip } from "@/components/mc/status-chip";
import { EmptyState } from "@/components/mc/empty-state";
import { Ltr } from "@/components/mc/ltr";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useMyContext } from "@/hooks/use-my-context";
import { useDepartmentsData } from "@/lib/departments-data";
import { DOCTOR_STATUSES, toneFor, useDoctorsRealtime } from "@/lib/doctor-status";

export const Route = createFileRoute("/_authenticated/_app/doctors-now")({
  head: () => ({ meta: [{ title: "Doctors now — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("doctorsNow")}>
      <Board />
    </RequireRole>
  ),
});

const fmtTime = (s: string) => s.slice(0, 5);

function Board() {
  const { t } = useTranslation();
  const { context } = useMyContext();
  const hid = context?.hospital?.id;
  useDoctorsRealtime(hid);
  const { depts, doctors, people } = useDepartmentsData();
  const today = new Date().getDay();
  const sched = useQuery({
    queryKey: ["doctor-schedules", hid, "today", today], enabled: !!hid,
    queryFn: async () => {
      const { data, error } = await supabase.from("doctor_schedules").select("doctor_id, start_time, end_time, room").eq("weekday", today).order("start_time");
      if (error) throw error;
      return data;
    },
  });

  if (doctors.isLoading) return <Skeleton className="h-64 w-full" />;
  const list = [...(doctors.data ?? [])].sort((a, b) => DOCTOR_STATUSES.indexOf(a.status as never) - DOCTOR_STATUSES.indexOf(b.status as never));
  if (list.length === 0) return <EmptyState icon={Radio} title={t("sched.boardEmpty")} description={t("sched.boardEmptyBody")} />;

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-2 animate-pulse rounded-full bg-success" />{t("sched.live")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((d) => {
          const name = people.data?.find((p) => p.id === d.user_id)?.full_name ?? t("doc.name");
          const dept = depts.data?.find((x) => x.id === d.department_id)?.name ?? "";
          const hours = (sched.data ?? []).filter((s) => s.doctor_id === d.id);
          return (
            <div key={d.id} className="rounded-staff border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{name}</div>
                  <div className="truncate text-xs text-muted-foreground">{[dept, d.specialty].filter(Boolean).join(" · ")}</div>
                </div>
                <StatusChip status={toneFor(d.status)}>{t(`doc.statuses.${d.status}`)}</StatusChip>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                {hours.length ? hours.map((h, i) => (
                  <div key={i}><Ltr>{fmtTime(h.start_time)}–{fmtTime(h.end_time)}</Ltr>{h.room ? <> · {t("sched.room")} <Ltr>{h.room}</Ltr></> : null}</div>
                )) : t("sched.noHoursToday")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
