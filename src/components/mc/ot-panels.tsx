import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { SidePanel } from "@/components/mc/side-panel";
import { PatientPicker } from "@/components/mc/book-appointment-panel";
import { Ltr } from "@/components/mc/ltr";
import { Banner } from "@/components/mc/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { useBookableDoctors } from "@/lib/appointments";
import { OT_SCHEDULERS, useTheatres, type OtBooking } from "@/lib/ot";

const NONE = "__none";
const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

function DoctorSelect({ value, onChange, allowNone }: { value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  const { t } = useTranslation();
  const docs = useBookableDoctors();
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger><SelectValue placeholder={t("ot.chooseDoctor")} /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{t("ot.none")}</SelectItem>}
        {!allowNone && <SelectItem value={NONE} disabled>{t("ot.chooseDoctor")}</SelectItem>}
        {(docs.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name} · {d.specialty}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function TheatreSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const ots = useTheatres();
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE} disabled>{t("ot.chooseTheatre")}</SelectItem>
        {(ots.data ?? []).filter((o) => o.status === "active").map((o) => <SelectItem key={o.id} value={o.id}>{o.name} · {t(`ot.types.${o.type}`)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** "+ OT booking": doctors send a request; the OT coordinator can also place it straight into a theatre. */
export function OtBookingPanel({ open, onOpenChange, initialOtId, initialStart }: {
  open: boolean; onOpenChange: (o: boolean) => void; initialOtId?: string | null | undefined; initialStart?: Date | null | undefined;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { hasRole } = useMyContext();
  const canSchedule = hasRole(...OT_SCHEDULERS);
  const docs = useBookableDoctors(open);
  const { context } = useMyContext();
  const [patient, setPatient] = useState<{ id: string; full_name: string; mrn: string } | null>(null);
  const [surgeon, setSurgeon] = useState("");
  const [anesthetist, setAnesthetist] = useState("");
  const [procedure, setProcedure] = useState("");
  const [priority, setPriority] = useState<"elective" | "emergency">("elective");
  const [minutes, setMinutes] = useState("60");
  const [cleaning, setCleaning] = useState("30");
  const [otId, setOtId] = useState("");
  const [start, setStart] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPatient(null); setProcedure(""); setPriority("elective"); setMinutes("60"); setCleaning("30"); setNote(""); setErr(null);
    setAnesthetist(""); setOtId(initialOtId ?? ""); setStart(initialStart ? toLocalInput(initialStart) : "");
  }, [open, initialOtId, initialStart]);
  useEffect(() => {
    const me = (docs.data ?? []).find((d) => d.user_id === context?.profile?.id);
    if (open && me && !surgeon) setSurgeon(me.id);
  }, [open, docs.data, context?.profile?.id, surgeon]);

  const submit = async () => {
    if (!patient || !surgeon || !procedure.trim()) { setErr(t("ot.fillRequired")); return; }
    setBusy(true); setErr(null);
    try {
      const bk = await callEdgeFunction<OtBooking>("request-ot", {
        patient_id: patient.id, surgeon_id: surgeon, anesthetist_id: anesthetist || null, procedure, priority,
        planned_minutes: Number(minutes), cleaning_minutes: Number(cleaning), note: note || null,
        planned_start: start ? new Date(start).toISOString() : null,
      });
      if (canSchedule && otId && start) {
        try {
          await callEdgeFunction("schedule-ot", { booking_id: bk.id, ot_id: otId, planned_start: new Date(start).toISOString() });
          toast.success(t("ot.scheduled"));
        } catch (e) {
          toast.warning(t("ot.savedNotScheduled"), { description: (e as EdgeError).message });
        }
      } else toast.success(t("ot.requested"));
      void qc.invalidateQueries({ queryKey: ["ot"] });
      onOpenChange(false);
    } catch (e) { setErr((e as EdgeError).message); }
    setBusy(false);
  };

  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title={t("quick.newOtBooking")}
      footer={<Button onClick={submit} disabled={busy}>{canSchedule && otId && start ? t("ot.saveSchedule") : t("ot.sendRequest")}</Button>}>
      <div className="space-y-4">
        {err && <Banner tone="danger" title={err} />}
        <div className="space-y-1.5">
          <Label>{t("ot.patient")}</Label>
          {patient ? (
            <div className="flex items-center justify-between rounded-staff border px-3 py-2 text-sm">
              <span>{patient.full_name} <Ltr className="text-muted-foreground">{patient.mrn}</Ltr></span>
              <Button variant="ghost" size="sm" onClick={() => setPatient(null)}>{t("ot.change")}</Button>
            </div>
          ) : <PatientPicker onPick={(p) => setPatient(p)} />}
        </div>
        <div className="space-y-1.5"><Label>{t("ot.procedure")}</Label><Input value={procedure} onChange={(e) => setProcedure(e.target.value)} maxLength={200} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>{t("ot.surgeon")}</Label><DoctorSelect value={surgeon} onChange={setSurgeon} /></div>
          <div className="space-y-1.5"><Label>{t("ot.anesthetist")}</Label><DoctorSelect value={anesthetist} onChange={setAnesthetist} allowNone /></div>
          <div className="space-y-1.5">
            <Label>{t("ot.priority")}</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as "elective" | "emergency")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="elective">{t("cal.legend.otPriority.elective")}</SelectItem>
                <SelectItem value="emergency">{t("cal.legend.otPriority.emergency")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>{t("ot.minutes")}</Label><Input type="number" min={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{t("ot.cleaning")}</Label><Input type="number" min={0} value={cleaning} onChange={(e) => setCleaning(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{canSchedule ? t("ot.start") : t("ot.preferredStart")}</Label><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          {canSchedule && <div className="space-y-1.5 sm:col-span-2"><Label>{t("ot.theatre")}</Label><TheatreSelect value={otId} onChange={setOtId} /></div>}
        </div>
        <div className="space-y-1.5"><Label>{t("ot.note")}</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
      </div>
    </SidePanel>
  );
}

/** OT coordinator places (or moves) an existing request into a theatre slot. */
export function OtSchedulePanel({ booking, onOpenChange }: { booking: OtBooking | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [otId, setOtId] = useState("");
  const [start, setStart] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [cleaning, setCleaning] = useState("30");
  const [anesthetist, setAnesthetist] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!booking) return;
    setOtId(booking.ot_id ?? ""); setStart(booking.planned_start ? toLocalInput(new Date(booking.planned_start)) : "");
    setMinutes(String(booking.planned_minutes)); setCleaning(String(booking.cleaning_minutes)); setAnesthetist(booking.anesthetist_id ?? ""); setErr(null);
  }, [booking]);

  const submit = async () => {
    if (!booking || !otId || !start) { setErr(t("ot.fillRequired")); return; }
    setBusy(true); setErr(null);
    try {
      await callEdgeFunction("schedule-ot", {
        booking_id: booking.id, ot_id: otId, planned_start: new Date(start).toISOString(),
        planned_minutes: Number(minutes), cleaning_minutes: Number(cleaning), anesthetist_id: anesthetist || null,
      });
      toast.success(t("ot.scheduled"));
      void qc.invalidateQueries({ queryKey: ["ot"] });
      onOpenChange(false);
    } catch (e) { setErr((e as EdgeError).message); }
    setBusy(false);
  };

  return (
    <SidePanel open={!!booking} onOpenChange={onOpenChange} title={t("ot.scheduleTitle")}
      footer={<Button onClick={submit} disabled={busy}>{t("ot.saveSchedule")}</Button>}>
      {booking && (
        <div className="space-y-4">
          {err && <Banner tone="danger" title={err} />}
          <p className="text-sm"><span className="font-semibold">{booking.procedure}</span> — {booking.patients?.full_name} <Ltr className="text-muted-foreground">{booking.patients?.mrn}</Ltr></p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label>{t("ot.theatre")}</Label><TheatreSelect value={otId} onChange={setOtId} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>{t("ot.start")}</Label><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>{t("ot.minutes")}</Label><Input type="number" min={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>{t("ot.cleaning")}</Label><Input type="number" min={0} value={cleaning} onChange={(e) => setCleaning(e.target.value)} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>{t("ot.anesthetist")}</Label><DoctorSelect value={anesthetist} onChange={setAnesthetist} allowNone /></div>
          </div>
          <p className="text-xs text-muted-foreground">{t("ot.cleaningHint")}</p>
        </div>
      )}
    </SidePanel>
  );
}
