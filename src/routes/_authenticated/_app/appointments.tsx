import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { addDays, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { CalendarPlus, ExternalLink, XCircle } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { BookAppointmentPanel } from "@/components/mc/book-appointment-panel";
import { Calendar, type CalColumn, type CalEvent, type CalendarView } from "@/components/mc/calendar";
import { ConfirmDialog } from "@/components/mc/confirm-dialog";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip, type Status } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { useDepartmentsData } from "@/lib/departments-data";
import {
  APPT_STATUSES, APPT_TYPES, useAppointmentsRealtime, useBookableDoctors, useCalendarData, type RangeAppointment,
} from "@/lib/appointments";

export const Route = createFileRoute("/_authenticated/_app/appointments")({
  head: () => ({ meta: [{ title: "Appointments calendar — MediCore HMS" }, { name: "description", content: "Reception calendar: book, move and cancel OPD appointments by doctor, day, week or month." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("appointments")}>
      <AppointmentsPage />
    </RequireRole>
  ),
});

const TONE: Record<string, Status> = {
  booked: "progress", waiting: "caution", in_consultation: "warning", done: "ok",
  no_show: "inactive", cancelled: "inactive", needs_rebooking: "urgent",
};
const BOOKERS = ["super_admin", "admin", "receptionist", "dept_head", "doctor", "er_officer"] as const;
const MOVABLE = ["booked", "waiting", "needs_rebooking"];
const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const atTime = (day: Date, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); const d = new Date(day); d.setHours(h!, m!, 0, 0); return d; };

function AppointmentsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { hasRole, context } = useMyContext();
  const canBook = hasRole(...BOOKERS);
  useAppointmentsRealtime(context?.hospital?.id);

  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<CalendarView>("byDoctor");
  const [from, to] = view === "month" ? [startOfWeek(startOfMonth(date), { weekStartsOn: 1 }), endOfWeek(endOfMonth(date), { weekStartsOn: 1 })]
    : view === "week" ? [startOfWeek(date, { weekStartsOn: 1 }), endOfWeek(date, { weekStartsOn: 1 })] : [date, date];
  const { appts, schedules, leaves } = useCalendarData(ymd(from), ymd(to));
  const doctors = useBookableDoctors();
  const { depts } = useDepartmentsData();

  const [booking, setBooking] = useState<{ doctorId: string | null; start: Date | null } | null>(null);
  const [selected, setSelected] = useState<RangeAppointment | null>(null);
  const [move, setMove] = useState<{ appt: RangeAppointment; start: Date; doctorId: string } | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const byId = useMemo(() => new Map((appts.data ?? []).map((a) => [a.id, a])), [appts.data]);
  const doctorName = (id: string) => doctors.data?.find((d) => d.id === id)?.full_name ?? t("doc.name");

  const events: CalEvent[] = (appts.data ?? []).filter((a) => a.status !== "cancelled").map((a) => ({
    id: a.id, start: new Date(a.slot_start), end: new Date(a.slot_end),
    title: a.patients?.full_name ?? "—", subtitle: view === "byDoctor" ? a.patients?.mrn : doctorName(a.doctor_id),
    columnId: a.doctor_id, departmentId: a.department_id, colorKey: a.status, status: a.status, type: a.type,
    token: a.token_no, draggable: canBook && MOVABLE.includes(a.status),
  }));

  const columns: CalColumn[] = (doctors.data ?? []).map((d) => {
    const weekday = date.getDay();
    const day = ymd(date);
    const onLeave = (leaves.data ?? []).some((l) => l.doctor_id === d.id && l.from_date <= day && l.to_date >= day);
    return {
      id: d.id, label: d.full_name, sub: d.specialty, departmentId: d.department_id,
      available: (schedules.data ?? []).filter((s) => s.doctor_id === d.id && s.weekday === weekday)
        .map((s) => ({ start: atTime(date, s.start_time), end: atTime(date, s.end_time) })),
      blocked: onLeave ? [{ start: date, end: addDays(date, 1), label: t("cal.onLeave") }] : [],
    };
  });

  const doMove = async (reason: string) => {
    if (!move) return;
    try {
      await callEdgeFunction("reschedule-appointment", {
        appointment_id: move.appt.id, slot_start: move.start.toISOString(), doctor_id: move.doctorId, reason,
      });
      toast.success(t("cal.moved"));
    } catch (e) { toast.error((e as EdgeError).message); }
    void qc.invalidateQueries({ queryKey: ["appointments"] });
    setMove(null);
  };
  const doCancel = async (reason: string) => {
    if (!cancelId) return;
    try {
      await callEdgeFunction("cancel-appointment", { appointment_id: cancelId, reason });
      toast.success(t("appt.cancelled")); setSelected(null);
    } catch (e) { toast.error((e as EdgeError).message); }
    void qc.invalidateQueries({ queryKey: ["appointments"] });
    setCancelId(null);
  };

  return (
    <div className="space-y-4">
      <Calendar
        events={events} columns={columns} date={date} onDateChange={(d) => setDate(startOfDay(d))}
        view={view} onViewChange={setView} mode="status"
        loading={appts.isFetching}
        departments={(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
        types={APPT_TYPES.map((x) => ({ value: x, label: t(`appt.types.${x}`) }))}
        statuses={APPT_STATUSES.filter((s) => s !== "cancelled").map((x) => ({ value: x, label: t(`appt.statuses.${x}`) }))}
        onSlotClick={canBook ? (start, columnId) => setBooking({ doctorId: columnId, start }) : undefined}
        onEventClick={(e) => setSelected(byId.get(e.id) ?? null)}
        onEventDrop={canBook ? (e, start, columnId) => {
          const a = byId.get(e.id);
          if (a && (start.getTime() !== new Date(a.slot_start).getTime() || columnId !== a.doctor_id))
            setMove({ appt: a, start, doctorId: columnId ?? a.doctor_id });
        } : undefined}
        toolbarEnd={canBook && <Button size="sm" className="h-8" onClick={() => setBooking({ doctorId: null, start: null })}><CalendarPlus className="size-4" />{t("appt.bookTitle")}</Button>}
      />

      <BookAppointmentPanel open={!!booking} onOpenChange={(o) => !o && setBooking(null)}
        initialDoctorId={booking?.doctorId} initialStart={booking?.start} />

      <SidePanel open={!!selected} onOpenChange={(o) => !o && setSelected(null)} title={t("cal.details")}
        footer={selected && (
          <>
            {canBook && MOVABLE.includes(selected.status) && (
              <Button variant="outline" onClick={() => setCancelId(selected.id)}><XCircle className="size-4" />{t("appt.cancel")}</Button>
            )}
            <Button asChild><Link to="/patients/$patientId" params={{ patientId: selected.patient_id }}><ExternalLink className="size-4" />{t("pat.openRecord")}</Link></Button>
          </>
        )}>
        {selected && (
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">{selected.patients?.full_name}</span>
              <StatusChip status={TONE[selected.status] ?? "inactive"}>{t(`appt.statuses.${selected.status}`)}</StatusChip>
            </div>
            {[
              [t("pat.mrnLabel"), <Ltr key="m">{selected.patients?.mrn}</Ltr>],
              [t("appt.token"), <Ltr key="t" className="font-semibold">{selected.token_no ?? "—"}</Ltr>],
              [t("appt.doctor"), doctorName(selected.doctor_id)],
              [t("appt.date"), <Ltr key="d">{format(new Date(selected.slot_start), "dd MMM yyyy, HH:mm")}</Ltr>],
              [t("appt.type"), t(`appt.types.${selected.type}`)],
              [t("appt.fee"), <Ltr key="f">{`Rs ${Number(selected.fee).toLocaleString("en-PK")}`}</Ltr>],
            ].map(([k, v], i) => (
              <div key={i} className="grid grid-cols-[8rem_1fr] gap-2"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>
            ))}
            {canBook && MOVABLE.includes(selected.status) && <p className="text-xs text-muted-foreground">{t("cal.dragHint")}</p>}
          </dl>
        )}
      </SidePanel>

      <ConfirmDialog open={!!move} onOpenChange={(o) => !o && setMove(null)} title={t("cal.moveTitle")}
        description={move ? t("cal.moveDesc", { name: move.appt.patients?.full_name ?? "", doctor: doctorName(move.doctorId), when: format(move.start, "dd MMM, HH:mm") }) : ""}
        confirmLabel={t("cal.move")} onConfirm={doMove} />
      <ConfirmDialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)} title={t("appt.cancelTitle")}
        confirmLabel={t("appt.cancel")} danger onConfirm={doCancel} />
    </div>
  );
}
