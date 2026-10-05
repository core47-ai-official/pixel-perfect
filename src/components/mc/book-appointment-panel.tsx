import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Printer, Search, X } from "lucide-react";
import { SidePanel } from "@/components/mc/side-panel";
import { DatePicker } from "@/components/mc/date-picker";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { AppointmentSlip } from "@/components/mc/appointment-slip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { useDepartmentsData } from "@/lib/departments-data";
import { APPT_TYPES, useBookableDoctors, useSlots, ymd, type ApptType, type BookedAppointment } from "@/lib/appointments";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface PickedPatient { id: string; full_name: string; mrn: string; print_language: string | null }
const ALL = "__all";

export function BookAppointmentPanel({ open, onOpenChange, patientId, initialDoctorId, initialStart }: {
  open: boolean; onOpenChange: (o: boolean) => void; patientId?: string | undefined;
  /** Pre-fill from a calendar click. */
  initialDoctorId?: string | null | undefined; initialStart?: Date | null | undefined;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { depts } = useDepartmentsData();
  const doctors = useBookableDoctors(open);

  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [dept, setDept] = useState(ALL);
  const [gender, setGender] = useState(ALL);
  const [lang, setLang] = useState(ALL);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [slot, setSlot] = useState<string | null>(null);
  const [type, setType] = useState<ApptType>("new");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<BookedAppointment | null>(null);
  const [slipOpen, setSlipOpen] = useState(false);
  const pendingSlot = useRef<number | null>(null);

  // Reset when reopened; preload a patient when opened from a profile.
  useEffect(() => {
    if (!open) return;
    setBooked(null); setError(null); setSlot(null); setDoctorId(initialDoctorId ?? null); setType("new");
    setDate(initialStart ?? new Date()); pendingSlot.current = initialStart ? initialStart.getTime() : null;
    setPatient(null);
    if (patientId) {
      void supabase.from("patients").select("id, full_name, mrn, print_language").eq("id", patientId).maybeSingle()
        .then(({ data }) => data && setPatient(data as PickedPatient));
    }
  }, [open, patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const languages = useMemo(() => [...new Set((doctors.data ?? []).flatMap((d) => d.languages))].sort(), [doctors.data]);
  const filtered = (doctors.data ?? []).filter((d) =>
    (dept === ALL || d.department_id === dept) && (gender === ALL || d.gender === gender) && (lang === ALL || d.languages.includes(lang)));
  const doctor = doctors.data?.find((d) => d.id === doctorId) ?? null;
  const dateStr = date ? ymd(date) : null;
  const slots = useSlots(doctorId, dateStr);
  useEffect(() => setSlot(null), [doctorId, dateStr]);
  // Select the clicked calendar time once its slot list arrives.
  useEffect(() => {
    if (pendingSlot.current == null || !slots.data) return;
    const hit = slots.data.slots.find((s) => s.status === "free" && new Date(s.start).getTime() <= pendingSlot.current! && new Date(s.end).getTime() > pendingSlot.current!);
    if (hit) setSlot(hit.start);
    pendingSlot.current = null;
  }, [slots.data]);
  useEffect(() => { if (doctorId && !filtered.some((d) => d.id === doctorId)) setDoctorId(null); }, [dept, gender, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const fee = doctor ? Number(type === "follow_up" ? doctor.followup_fee : doctor.consultation_fee) : null;

  const book = async () => {
    if (!patient || !doctor || !slot) return;
    setSaving(true); setError(null);
    try {
      const res = await callEdgeFunction<BookedAppointment>("book-appointment", {
        patient_id: patient.id, doctor_id: doctor.id, slot_start: slot, type, channel: "reception",
      });
      setBooked(res);
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success(t("appt.booked", { token: res.token_no }));
    } catch (e) {
      const err = e as EdgeError;
      setError(err.code === "slot_taken" ? t("appt.slotTaken") : err.message);
      if (err.code === "slot_taken" || err.code === "full") { setSlot(null); void slots.refetch(); }
    } finally { setSaving(false); }
  };

  return (
    <>
      <SidePanel
        open={open} onOpenChange={onOpenChange} title={t("appt.bookTitle")}
        footer={booked ? (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("shell.close")}</Button>
            <Button onClick={() => setSlipOpen(true)}><Printer className="size-4" />{t("appt.printSlip")}</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("dash.cancel")}</Button>
            <Button onClick={book} disabled={!patient || !doctor || !slot || saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}{t("appt.book")}
            </Button>
          </>
        )}
      >
        {booked && patient ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto size-10 text-ok" />
            <p className="font-medium">{t("appt.confirmed")}</p>
            <div className="rounded-staff border bg-card p-4">
              <p className="text-xs text-muted-foreground">{t("appt.token")}</p>
              <p className="text-4xl font-bold"><Ltr>{booked.token_no}</Ltr></p>
              <p className="mt-2 text-sm">{patient.full_name} · <Ltr>{patient.mrn}</Ltr></p>
              <p className="text-sm text-muted-foreground">{booked.doctor_name} · <Ltr>{`${dateStr} ${booked.time}`}</Ltr></p>
              <p className="mt-2 font-semibold"><Ltr>{`Rs ${Number(booked.fee).toLocaleString("en-PK")}`}</Ltr></p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {error && <Banner tone="danger" title={error} />}
            {doctors.isError && <Banner tone="warning" title={t("appt.fnMissing")} />}

            <div className="space-y-1.5">
              <Label>{t("appt.patient")}</Label>
              {patient ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{patient.full_name} · <Ltr className="text-muted-foreground">{patient.mrn}</Ltr></span>
                  {!patientId && <Button size="icon" variant="ghost" className="size-7" aria-label={t("appt.changePatient")} onClick={() => setPatient(null)}><X className="size-4" /></Button>}
                </div>
              ) : <PatientPicker onPick={setPatient} />}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label>{t("appt.department")}</Label>
                <Select value={dept} onValueChange={setDept}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("appt.any")}</SelectItem>
                    {(depts.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("appt.gender")}</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("appt.any")}</SelectItem>
                    {["male", "female"].map((g) => <SelectItem key={g} value={g}>{t(`doc.genders.${g}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("appt.language")}</Label>
                <Select value={lang} onValueChange={setLang}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("appt.any")}</SelectItem>
                    {languages.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("appt.doctor")}</Label>
              <Select value={doctorId ?? ""} onValueChange={setDoctorId}>
                <SelectTrigger><SelectValue placeholder={doctors.isLoading ? t("search.searching") : t("appt.pickDoctor")} /></SelectTrigger>
                <SelectContent>
                  {filtered.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("appt.noDoctors")}</div>}
                  {filtered.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.full_name} · {d.specialty}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>{t("appt.date")}</Label>
                <DatePicker value={date} onChange={setDate} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("appt.type")}</Label>
                <Select value={type} onValueChange={(v) => setType(v as ApptType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{APPT_TYPES.map((x) => <SelectItem key={x} value={x}>{t(`appt.types.${x}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {doctor && dateStr && (
              <div className="space-y-1.5">
                <Label>{t("appt.slot")}</Label>
                {slots.isLoading ? <p className="text-sm text-muted-foreground">{t("search.searching")}</p>
                  : slots.isError ? <Banner tone="warning" title={(slots.error as unknown as EdgeError).message} />
                  : slots.data?.closed ? <p className="text-sm text-muted-foreground">{t(`appt.closed.${slots.data.closed}`, { name: slots.data.holiday ?? "" })}</p>
                  : (
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                      {slots.data?.slots.map((s) => (
                        <button key={s.start} type="button" disabled={s.status !== "free"} onClick={() => setSlot(s.start)}
                          aria-pressed={slot === s.start}
                          className={cn("rounded-md border px-1 py-1.5 text-xs tnum transition-colors",
                            s.status === "free" && "hover:bg-accent",
                            slot === s.start && "border-primary bg-primary text-primary-foreground hover:bg-primary",
                            s.status !== "free" && "cursor-not-allowed bg-muted text-muted-foreground line-through")}>
                          <Ltr>{s.time}</Ltr>
                          {s.status === "full" && <span className="block text-[10px] no-underline">{t("appt.full")}</span>}
                        </button>
                      ))}
                    </div>
                  )}
              </div>
            )}

            {fee !== null && (
              <div className="flex items-center justify-between rounded-staff border bg-muted/40 px-3 py-2 text-sm">
                <span>{t("appt.fee")}</span>
                <Ltr className="font-semibold">{`Rs ${fee.toLocaleString("en-PK")}`}</Ltr>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("appt.tokenNote")}</p>
          </div>
        )}
      </SidePanel>
      {booked && patient && <AppointmentSlip appt={booked} patient={patient} open={slipOpen} onOpenChange={setSlipOpen} />}
    </>
  );
}

function PatientPicker({ onPick }: { onPick: (p: PickedPatient) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [deb, setDeb] = useState("");
  useEffect(() => { const h = setTimeout(() => setDeb(q.trim()), 300); return () => clearTimeout(h); }, [q]);
  const res = useQuery({
    queryKey: ["patients", "search", deb],
    queryFn: () => callEdgeFunction<(PickedPatient & { phone: string | null })[]>("search-patients", { q: deb }),
    enabled: deb.length >= 2, retry: false,
  });
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="ps-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search.placeholder")} />
      </div>
      {deb.length >= 2 && (
        <div className="max-h-48 overflow-auto rounded-md border">
          {res.isFetching ? <p className="px-3 py-2 text-sm text-muted-foreground">{t("search.searching")}</p>
            : (res.data ?? []).length === 0 ? <p className="px-3 py-2 text-sm text-muted-foreground">{t("search.none")}</p>
            : res.data!.map((p) => (
              <button key={p.id} type="button" onClick={() => onPick(p)} className="flex w-full justify-between px-3 py-2 text-start text-sm hover:bg-accent">
                <span>{p.full_name}</span><Ltr className="text-xs text-muted-foreground">{p.mrn}</Ltr>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
