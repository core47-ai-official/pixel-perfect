import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarPlus, XCircle } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { BookAppointmentPanel } from "@/components/mc/book-appointment-panel";
import { ConfirmDialog } from "@/components/mc/confirm-dialog";
import { DatePicker } from "@/components/mc/date-picker";
import { EmptyState } from "@/components/mc/empty-state";
import { StatusChip, type Status } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { pkTime, useBookableDoctors, useDayAppointments, ymd } from "@/lib/appointments";

export const Route = createFileRoute("/_authenticated/_app/appointments")({
  head: () => ({ meta: [{ title: "Appointments — MediCore HMS" }, { name: "description", content: "Book, view and cancel OPD appointments by day." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("appointments")}>
      <AppointmentsPage />
    </RequireRole>
  ),
});

const TONE: Record<string, Status> = {
  booked: "progress", waiting: "caution", in_consultation: "progress", done: "ok",
  no_show: "inactive", cancelled: "inactive", needs_rebooking: "urgent",
};
const BOOKERS = ["super_admin", "admin", "receptionist", "dept_head", "doctor", "er_officer"] as const;

function AppointmentsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { hasRole } = useMyContext();
  const canBook = hasRole(...BOOKERS);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const day = ymd(date ?? new Date());
  const list = useDayAppointments(day);
  const doctors = useBookableDoctors();
  const [booking, setBooking] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const cancel = async (reason: string) => {
    if (!cancelId) return;
    try {
      await callEdgeFunction("cancel-appointment", { appointment_id: cancelId, reason });
      toast.success(t("appt.cancelled"));
      void qc.invalidateQueries({ queryKey: ["appointments"] });
    } catch (e) { toast.error((e as EdgeError).message); }
    setCancelId(null);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-48"><DatePicker value={date} onChange={setDate} /></div>
        {canBook && <Button className="ms-auto" onClick={() => setBooking(true)}><CalendarPlus className="size-4" />{t("appt.bookTitle")}</Button>}
      </div>

      {list.isLoading ? <Skeleton className="h-64 w-full" /> : (list.data ?? []).length === 0 ? (
        <div className="rounded-staff border bg-card"><EmptyState title={t("appt.noneForDay")} /></div>
      ) : (
        <div className="overflow-x-auto rounded-staff border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-start text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start">{t("appt.time")}</th>
                <th className="px-3 py-2 text-start">{t("appt.token")}</th>
                <th className="px-3 py-2 text-start">{t("appt.patient")}</th>
                <th className="px-3 py-2 text-start">{t("appt.doctor")}</th>
                <th className="px-3 py-2 text-start">{t("appt.type")}</th>
                <th className="px-3 py-2 text-start">{t("appt.status")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.data!.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2"><Ltr>{pkTime(a.slot_start)}</Ltr></td>
                  <td className="px-3 py-2 font-semibold"><Ltr>{a.token_no ?? "—"}</Ltr></td>
                  <td className="px-3 py-2">
                    <Link to="/patients/$patientId" params={{ patientId: a.patient_id }} className="hover:underline">{a.patients?.full_name}</Link>
                    <Ltr className="block text-xs text-muted-foreground">{a.patients?.mrn}</Ltr>
                  </td>
                  <td className="px-3 py-2">{doctors.data?.find((d) => d.id === a.doctor_id)?.full_name ?? "—"}</td>
                  <td className="px-3 py-2">{t(`appt.types.${a.type}`)}</td>
                  <td className="px-3 py-2"><StatusChip status={TONE[a.status] ?? "inactive"}>{t(`appt.statuses.${a.status}`)}</StatusChip></td>
                  <td className="px-3 py-2 text-end">
                    {canBook && ["booked", "waiting", "needs_rebooking"].includes(a.status) && (
                      <Button size="sm" variant="ghost" onClick={() => setCancelId(a.id)}><XCircle className="size-4" />{t("appt.cancel")}</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BookAppointmentPanel open={booking} onOpenChange={setBooking} />
      <ConfirmDialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)} title={t("appt.cancelTitle")}
        confirmLabel={t("appt.cancel")} danger onConfirm={cancel} />
    </div>
  );
}
