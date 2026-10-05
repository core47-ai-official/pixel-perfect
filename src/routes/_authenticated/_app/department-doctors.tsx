import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BriefcaseMedical, CalendarCheck2 } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { StatusChip } from "@/components/mc/status-chip";
import { EmptyState } from "@/components/mc/empty-state";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useMyContext } from "@/hooks/use-my-context";
import { useDepartmentsData } from "@/lib/departments-data";
import { onLeaveToday, useLeaves } from "@/lib/doctor-leaves";
import { DOCTOR_STATUSES, toneFor, useDoctorsRealtime } from "@/lib/doctor-status";

export const Route = createFileRoute("/_authenticated/_app/department-doctors")({
  head: () => ({ meta: [
    { title: "Department doctors — MediCore HMS" },
    { name: "description", content: "Your department's doctors: live status, weekly hours and leave requests." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("deptDoctors")}>
      <DeptDoctors />
    </RequireRole>
  ),
});

const DAYS = [0, 1, 2, 3, 4, 5, 6];

function DeptDoctors() {
  const { t } = useTranslation();
  const { context } = useMyContext();
  const hid = context?.hospital?.id;
  const deptId = context?.department?.id;
  useDoctorsRealtime(hid);
  const { doctors, people } = useDepartmentsData();
  const leaves = useLeaves(hid);
  const away = onLeaveToday(leaves.data);
  const mine = (doctors.data ?? []).filter((d) => d.department_id === deptId);
  const ids = mine.map((d) => d.id);
  const sched = useQuery({
    queryKey: ["doctor-schedules", hid, "dept", ids.join(",")], enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("doctor_schedules").select("doctor_id, weekday, start_time, end_time, room").in("doctor_id", ids).order("start_time");
      if (error) throw error;
      return data;
    },
  });

  if (!deptId) return <Banner tone="info" title={t("dh.noDepartment")} />;
  if (doctors.isLoading) return <Skeleton className="h-64 w-full" />;
  const pending = (leaves.data ?? []).filter((l) => l.status === "pending" && ids.includes(l.doctor_id)).length;
  const list = mine.map((d) => (away.has(d.id) ? { ...d, status: "on_leave" } : d))
    .sort((a, b) => DOCTOR_STATUSES.indexOf(a.status as never) - DOCTOR_STATUSES.indexOf(b.status as never));
  const dayName = (n: number) => new Date(2024, 0, 7 + n).toLocaleDateString(undefined, { weekday: "short" });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t("nav.deptDoctors")} · {context?.department?.name}</h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><span className="size-2 animate-pulse rounded-full bg-ok" />{t("sched.live")}</p>
        </div>
        <Button asChild variant={pending ? "default" : "outline"}>
          <Link to="/leave-approvals"><CalendarCheck2 /> {t("dh.leaveRequests", { n: pending })}</Link>
        </Button>
      </div>
      {list.length === 0 ? <EmptyState icon={BriefcaseMedical} title={t("dh.noDoctors")} description={t("sched.boardEmptyBody")} /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((d) => {
            const name = people.data?.find((p) => p.id === d.user_id)?.full_name ?? t("doc.name");
            const hours = (sched.data ?? []).filter((s) => s.doctor_id === d.id);
            return (
              <div key={d.id} className="rounded-staff border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to="/doctors/$doctorId" params={{ doctorId: d.id }} className="truncate font-semibold hover:underline">{name}</Link>
                    <div className="truncate text-xs text-muted-foreground">{d.specialty}</div>
                  </div>
                  <StatusChip status={toneFor(d.status)}>{t(`doc.statuses.${d.status}`)}</StatusChip>
                </div>
                <dl className="mt-3 grid grid-cols-[4rem_1fr] gap-x-2 gap-y-0.5 text-xs">
                  {DAYS.map((n) => {
                    const h = hours.filter((s) => s.weekday === n);
                    if (!h.length) return null;
                    return [<dt key={`d${n}`} className="text-muted-foreground">{dayName(n)}</dt>,
                      <dd key={`h${n}`}>{h.map((s, i) => <Ltr key={i} className="me-2">{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}{s.room ? ` · ${s.room}` : ""}</Ltr>)}</dd>];
                  })}
                </dl>
                {!hours.length && <p className="mt-3 text-xs text-muted-foreground">{t("dh.noHours")}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
