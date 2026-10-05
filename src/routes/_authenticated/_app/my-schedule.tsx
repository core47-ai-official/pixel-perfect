import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { addDays, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Banner } from "@/components/mc/banner";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, type CalColumn, type CalEvent, type CalendarView } from "@/components/mc/calendar";
import { useMyContext } from "@/hooks/use-my-context";
import { useDepartmentsData } from "@/lib/departments-data";
import { useAppointmentsRealtime, useCalendarData, ymd } from "@/lib/appointments";
import { caseEnd, useOtBookings, useOtRealtime } from "@/lib/ot";

export const Route = createFileRoute("/_authenticated/_app/my-schedule")({
  head: () => ({
    meta: [
      { title: "My schedule — MediCore HMS" },
      { name: "description", content: "Your appointments, OT cases and leave on a calendar." },
    ],
  }),
  component: () => (
    <RequireRole roles={rolesForPage("mySchedule")}>
      <MySchedule />
    </RequireRole>
  ),
});

const atTime = (d: Date, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const x = new Date(d); x.setHours(h ?? 0, m ?? 0, 0, 0); return x;
};

function MySchedule() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { context } = useMyContext();
  useAppointmentsRealtime(context?.hospital?.id);
  const { doctors } = useDepartmentsData();
  const me = (doctors.data ?? []).find((d) => d.user_id === context?.profile?.id);
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<CalendarView>("week");
  const from = view === "month" ? startOfWeek(startOfMonth(date), { weekStartsOn: 1 }) : view === "week" ? startOfWeek(date, { weekStartsOn: 1 }) : date;
  const to = view === "month" ? endOfWeek(endOfMonth(date), { weekStartsOn: 1 }) : view === "week" ? endOfWeek(date, { weekStartsOn: 1 }) : date;
  const { appts, schedules, leaves } = useCalendarData(ymd(from), ymd(to));
  useOtRealtime(context?.hospital?.id);
  const ot = useOtBookings(startOfDay(from).toISOString(), addDays(startOfDay(to), 1).toISOString());

  if (doctors.isLoading) return <Skeleton className="h-64" />;
  if (!me) return <Banner tone="warning" title={t("myday.notDoctor")} />;

  const myLeaves = (leaves.data ?? []).filter((l) => l.doctor_id === me.id);
  const events: CalEvent[] = (appts.data ?? [])
    .filter((a) => a.doctor_id === me.id && a.status !== "cancelled")
    .map((a) => ({
      id: a.id, start: new Date(a.slot_start), end: new Date(a.slot_end), title: a.patients?.full_name ?? "—",
      subtitle: a.patients?.mrn, columnId: me.id, departmentId: a.department_id,
      colorKey: "appointment", status: a.status, type: a.type, token: a.token_no,
    }));
  // OT cases where I'm the surgeon or anesthetist.
  for (const b of ot.data ?? []) {
    if (!b.planned_start || (b.surgeon_id !== me.id && b.anesthetist_id !== me.id)) continue;
    events.push({
      id: `ot-${b.id}`, start: new Date(b.planned_start), end: caseEnd(b), title: `${t("cal.legend.eventKind.surgery")}: ${b.procedure}`,
      subtitle: b.patients?.full_name, columnId: me.id, colorKey: "surgery", status: b.status,
    });
  }
  // Each leave day appears as one event across working hours.
  for (const l of myLeaves) {
    for (let d = new Date(`${l.from_date}T00:00:00`); ymd(d) <= l.to_date; d = addDays(d, 1)) {
      if (d < from || d > to) continue;
      events.push({
        id: `leave-${l.from_date}-${ymd(d)}`, start: atTime(d, "08:00"), end: atTime(d, "20:00"),
        title: t("cal.onLeave"), subtitle: l.type, columnId: me.id, colorKey: "leave", status: "leave",
      });
    }
  }
  const day = ymd(date);
  const columns: CalColumn[] = [{
    id: me.id, label: t("myday.schedTitle"), departmentId: me.department_id,
    available: (schedules.data ?? []).filter((s) => s.doctor_id === me.id && s.weekday === date.getDay())
      .map((s) => ({ start: atTime(date, s.start_time), end: atTime(date, s.end_time) })),
    blocked: myLeaves.some((l) => l.from_date <= day && l.to_date >= day) ? [{ start: date, end: addDays(date, 1), label: t("cal.onLeave") }] : [],
  }];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("myday.schedTitle")}</h1>
      <Calendar
        mode="eventKind" events={events} columns={columns} date={date} onDateChange={(d) => setDate(startOfDay(d))}
        view={view} onViewChange={(v) => setView(v === "byDoctor" ? "day" : v)}
        loading={appts.isLoading}
        onEventClick={(e) => {
          if (e.id.startsWith("ot-")) { void navigate({ to: "/ot" }); return; }
          const a = appts.data?.find((x) => x.id === e.id);
          if (a) void navigate({ to: "/patients/$patientId", params: { patientId: a.patient_id } });
        }}
      />
    </div>
  );
}
