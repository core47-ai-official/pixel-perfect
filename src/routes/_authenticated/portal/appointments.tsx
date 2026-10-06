import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { PortalSlotPicker } from "@/components/mc/portal-slot-picker";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { supabase } from "@/integrations/supabase/client";
import { useBookableDoctors, type Slot } from "@/lib/appointments";
import { canChange, pkDay, pkTime, useMyPatient, usePortalHome } from "@/lib/portal";
import { NotLinked } from "./book";

export const Route = createFileRoute("/_authenticated/portal/appointments")({
  head: () => ({ meta: [{ title: "My appointments — Patient portal" }, { name: "description", content: "Your upcoming and past hospital appointments." }] }),
  component: Appointments,
});

interface Row { id: string; slot_start: string; token_no: number | null; status: string; doctor_id: string }
const ACTIVE = ["booked", "waiting", "in_consultation", "needs_rebooking"];

function Appointments() {
  const { t } = useTranslation();
  const me = useMyPatient();
  const home = usePortalHome();
  const doctors = useBookableDoctors(!!me.data);
  const q = useQuery({
    queryKey: ["portal", "appointments", me.data?.id], enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("appointments").select("id, slot_start, token_no, status, doctor_id").eq("patient_id", me.data!.id).order("slot_start", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  if (me.isLoading || q.isLoading) return <Skeleton className="h-40 rounded-patient" />;
  if (!me.data) return <NotLinked />;
  const now = Date.now();
  const upcoming = (q.data ?? []).filter((a) => ACTIVE.includes(a.status) && new Date(a.slot_start).getTime() > now - 3 * 3600_000).reverse();
  const past = (q.data ?? []).filter((a) => !upcoming.includes(a));
  const docName = (id: string) => doctors.data?.find((d) => d.id === id)?.full_name ?? "";
  const hours = home.data?.settings.cancellation_hours ?? 2;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("portal.nav.appointments")}</h1>
      <section className="space-y-3">
        <h2 className="font-medium">{t("portal.appts.upcoming")}</h2>
        {!upcoming.length ? <PCard><p className="text-muted-foreground">{t("portal.noNextAppt")}</p></PCard>
          : upcoming.map((a) => <ApptCard key={a.id} a={a} doctor={docName(a.doctor_id)} hours={hours} windowDays={home.data?.settings.booking_window_days ?? 30} />)}
        <p className="text-xs text-muted-foreground">{t("portal.appts.cutoff", { hours })}</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">{t("portal.appts.past")}</h2>
        {!past.length ? <PCard><p className="text-muted-foreground">{t("portal.noAppts")}</p></PCard>
          : past.map((a) => <ApptCard key={a.id} a={a} doctor={docName(a.doctor_id)} hours={hours} windowDays={0} readOnly />)}
      </section>
    </div>
  );
}

function ApptCard({ a, doctor, hours, windowDays, readOnly }: { a: Row; doctor: string; hours: number; windowDays: number; readOnly?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [mode, setMode] = useState<null | "cancel" | "move">(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = !readOnly && canChange(a, hours);
  const run = async (fn: string, body: Record<string, unknown>, ok: string) => {
    setBusy(true); setError(null);
    try { await callEdgeFunction(fn, body); toast.success(ok); setMode(null); setSlot(null); await qc.invalidateQueries({ queryKey: ["portal"] }); }
    catch (e) { setError((e as { message?: string })?.message ?? t("portal.appts.failed")); }
    finally { setBusy(false); }
  };
  return (
    <PCard className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium"><Ltr>{pkDay(a.slot_start)} · {pkTime(a.slot_start)}</Ltr></p>
          {doctor && <p className="text-sm">{doctor}</p>}
          {a.token_no != null && <p className="text-sm text-muted-foreground">{t("portal.token")} <Ltr>{a.token_no}</Ltr></p>}
        </div>
        <span className="rounded-full border px-3 py-0.5 text-xs">{t(`portal.apptStatus.${a.status}`, { defaultValue: a.status })}</span>
      </div>
      {error && <Banner tone="danger" title={error} />}
      {editable && !mode && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="rounded-patient" onClick={() => setMode("move")}>{t("portal.appts.reschedule")}</Button>
          <Button variant="outline" className="rounded-patient text-destructive" onClick={() => setMode("cancel")}>{t("portal.appts.cancel")}</Button>
        </div>
      )}
      {mode === "cancel" && (
        <div className="space-y-2">
          <p className="text-sm">{t("portal.appts.cancelConfirm")}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="rounded-patient" onClick={() => setMode(null)}>{t("portal.appts.keep")}</Button>
            <Button variant="destructive" className="rounded-patient" disabled={busy}
              onClick={() => void run("cancel-appointment", { appointment_id: a.id, reason: "Cancelled by patient (portal)" }, t("portal.appts.cancelled"))}>{t("portal.appts.cancel")}</Button>
          </div>
        </div>
      )}
      {mode === "move" && (
        <div className="space-y-3">
          <PortalSlotPicker doctorId={a.doctor_id} windowDays={windowDays} selected={slot} onPick={setSlot} />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="rounded-patient" onClick={() => { setMode(null); setSlot(null); }}>{t("portal.appts.keep")}</Button>
            <Button className="rounded-patient" disabled={!slot || busy}
              onClick={() => slot && void run("reschedule-appointment", { appointment_id: a.id, slot_start: slot.start, reason: "Rescheduled by patient (portal)" }, t("portal.appts.moved"))}>{t("portal.appts.moveHere")}</Button>
          </div>
        </div>
      )}
    </PCard>
  );
}
