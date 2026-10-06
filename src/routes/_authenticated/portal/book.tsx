import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronLeft, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { PortalSlotPicker } from "@/components/mc/portal-slot-picker";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useBookableDoctors, type BookableDoctor, type BookedAppointment, type Slot } from "@/lib/appointments";
import { formatPkr } from "@/lib/patient-summary";
import { pkDay, useMyPatient, usePortalHome } from "@/lib/portal";

export const Route = createFileRoute("/_authenticated/portal/book")({
  head: () => ({ meta: [{ title: "Book a visit — Patient portal" }, { name: "description", content: "Book an appointment with a hospital doctor." }] }),
  component: Book,
});

function Book() {
  const { t } = useTranslation();
  const me = useMyPatient();
  const home = usePortalHome();
  const enabled = !!me.data && home.data?.settings.allow_patient_booking === true;
  const doctors = useBookableDoctors(enabled);
  const [dept, setDept] = useState<string | null>(null);
  const [doc, setDoc] = useState<BookableDoctor | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const depts = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of doctors.data ?? []) if (d.department_id) m.set(d.department_id, d.department_name ?? "—");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [doctors.data]);

  if (me.isLoading || home.isLoading) return <Skeleton className="h-40 rounded-patient" />;
  if (!me.data) return <NotLinked />;
  if (!home.data?.settings.allow_patient_booking) return (
    <div className="space-y-3"><h1 className="text-xl font-semibold">{t("portal.nav.book")}</h1>
      <PCard><p className="text-muted-foreground">{t("portal.book.off")}</p></PCard></div>
  );

  const confirm = async () => {
    if (!doc || !slot) return;
    setBusy(true); setError(null);
    try {
      const r = await callEdgeFunction<BookedAppointment>("book-appointment", { patient_id: me.data!.id, doctor_id: doc.id, slot_start: slot.start, type: "new", channel: "portal" });
      toast.success(t("portal.book.done", { token: r.token_no ?? "" }));
      await qc.invalidateQueries({ queryKey: ["portal"] });
      void navigate({ to: "/portal/appointments" });
    } catch (e) {
      setError((e as { message?: string })?.message ?? t("portal.book.failed"));
      setSlot(null);
      void qc.invalidateQueries({ queryKey: ["appointments", "slots"] });
    } finally { setBusy(false); }
  };

  const back = () => { setError(null); if (slot) setSlot(null); else if (doc) setDoc(null); else setDept(null); };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {dept && <Button variant="ghost" size="icon" onClick={back} aria-label={t("common.back", { defaultValue: "Back" })}><ChevronLeft className="rtl:rotate-180" /></Button>}
        <h1 className="text-xl font-semibold">{!dept ? t("portal.book.pickDept") : !doc ? t("portal.book.pickDoctor") : t("portal.book.pickSlot")}</h1>
      </div>
      {error && <Banner tone="danger" title={error} />}
      {doctors.isLoading ? <Skeleton className="h-40 rounded-patient" />
        : doctors.isError ? <Banner tone="danger" title={t("portal.book.failedDoctors")} />
        : !dept ? (
          !depts.length ? <PCard><p className="text-muted-foreground">{t("portal.book.noDoctors")}</p></PCard> :
          <div className="grid grid-cols-2 gap-3">
            {depts.map(([id, name]) => (
              <button key={id} type="button" onClick={() => setDept(id)} className="rounded-patient border bg-card p-4 text-start font-medium shadow-sm">{name}</button>
            ))}
          </div>
        ) : !doc ? (
          <div className="space-y-3">
            {(doctors.data ?? []).filter((d) => d.department_id === dept).map((d) => (
              <button key={d.id} type="button" onClick={() => setDoc(d)} className="flex w-full items-center gap-3 rounded-patient border bg-card p-3 text-start shadow-sm">
                <DoctorPhoto d={d} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{d.full_name}</p>
                  <p className="text-sm text-muted-foreground">{d.specialty}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.gender ? t(`portal.book.gender.${d.gender}`, { defaultValue: d.gender }) : ""}
                    {d.languages?.length ? ` · ${d.languages.join(", ")}` : ""}
                  </p>
                </div>
                <span className="text-sm font-semibold"><Ltr>{formatPkr(d.consultation_fee)}</Ltr></span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <PCard className="flex items-center gap-3"><DoctorPhoto d={doc} />
              <div><p className="font-semibold">{doc.full_name}</p><p className="text-sm text-muted-foreground">{t("portal.book.fee")} <Ltr>{formatPkr(doc.consultation_fee)}</Ltr></p></div></PCard>
            <PortalSlotPicker doctorId={doc.id} windowDays={home.data.settings.booking_window_days} selected={slot} onPick={setSlot} />
            {slot && (
              <PCard className="space-y-3">
                <p>{t("portal.book.confirmText", { doctor: doc.full_name })} <Ltr className="font-semibold">{pkDay(slot.start)} · {slot.time}</Ltr></p>
                <p className="text-sm text-muted-foreground">{t("portal.bills.payNote")}</p>
                <Button size="lg" className="w-full rounded-patient" disabled={busy} onClick={() => void confirm()}>{t("portal.book.confirm")}</Button>
              </PCard>
            )}
          </>
        )}
    </div>
  );
}

function DoctorPhoto({ d }: { d: BookableDoctor }) {
  return d.photo_url
    ? <img src={d.photo_url} alt="" className="size-14 shrink-0 rounded-full object-cover" />
    : <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted"><UserRound className="size-7 text-muted-foreground" aria-hidden /></span>;
}

/** Shown on portal tabs until the account is linked to a hospital record. */
export function NotLinked() {
  const { t } = useTranslation();
  return (
    <PCard className="space-y-3">
      <p>{t("portal.notLinked")}</p>
      <Button asChild className="rounded-patient"><Link to="/portal">{t("portal.link.title")}</Link></Button>
    </PCard>
  );
}
