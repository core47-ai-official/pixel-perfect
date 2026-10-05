import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Megaphone, Monitor, UserPlus, X } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/mc/empty-state";
import { SidePanel } from "@/components/mc/side-panel";
import { Ltr } from "@/components/mc/ltr";
import { PatientPicker } from "@/components/mc/book-appointment-panel";
import { useMyContext } from "@/hooks/use-my-context";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useDepartmentsData } from "@/lib/departments-data";
import { pkTime, useAppointmentsRealtime, useBookableDoctors, useDayAppointments } from "@/lib/appointments";

export const Route = createFileRoute("/_authenticated/_app/opd-queue")({
  head: () => ({ meta: [{ title: "Token queue — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("opdQueue")}>
      <Queue />
    </RequireRole>
  ),
});

const todayPk = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

function Queue() {
  const { t } = useTranslation();
  const { context, hasRole } = useMyContext();
  const hid = context?.hospital?.id;
  useAppointmentsRealtime(hid);
  const day = todayPk();
  const appts = useDayAppointments(day);
  const docsQ = useBookableDoctors();
  const { doctors: myDocs } = useDepartmentsData();
  const { values } = useCompanySettings();
  const avg = Number(values.opd?.["avg_consult_minutes"] ?? 10) || 10;
  const tvToken = String(values.opd?.["tv_display_token"] ?? "");
  const isReception = hasRole("receptionist", "admin", "super_admin");
  const myDoctor = (myDocs.data ?? []).find((d) => d.user_id === context?.profile?.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [walkIn, setWalkIn] = useState(false);

  const run = async (key: string, fn: string, body: unknown, ok?: (d: any) => string) => {
    setBusy(key);
    try {
      const d = await callEdgeFunction<any>(fn, body);
      if (ok) toast.success(ok(d));
      await appts.refetch();
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? t("errors.generic"));
    } finally { setBusy(null); }
  };

  const groups = useMemo(() => {
    let docs = docsQ.data ?? [];
    if (!isReception && myDoctor) docs = docs.filter((d) => d.id === myDoctor.id);
    const list = appts.data ?? [];
    return docs.map((d) => {
      const mine = list.filter((a) => a.doctor_id === d.id);
      const serving = mine.find((a) => a.status === "in_consultation") ?? null;
      const waiting = mine.filter((a) => a.status === "waiting").sort((a, b) => (a.token_no ?? 0) - (b.token_no ?? 0));
      const expected = mine.filter((a) => a.status === "booked").sort((a, b) => a.slot_start.localeCompare(b.slot_start));
      return { d, serving, waiting, expected };
    }).filter((g) => !isReception || g.serving || g.waiting.length || g.expected.length);
  }, [docsQ.data, appts.data, isReception, myDoctor]);

  const tvUrl = (doctorId: string) => `${window.location.origin}/tv/${doctorId}?token=${encodeURIComponent(tvToken)}`;
  const copyTv = (id: string) => {
    if (tvToken.length < 8) { toast.error(t("queue.tvNoToken")); return; }
    void navigator.clipboard.writeText(tvUrl(id)); toast.success(t("queue.tvCopied"));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("queue.title")} · <span className="text-muted-foreground"><Ltr>{day}</Ltr></span></h1>
        <div className="flex gap-2">
          {myDoctor && (
            <Button disabled={busy === "next"} onClick={() => run("next", "call-next-token", {},
              (d) => d ? t("queue.called", { token: d.token_no }) : t("queue.queueEmpty"))}>
              <Megaphone className="size-4" />{t("queue.callNext")}
            </Button>
          )}
          {isReception && <Button variant="outline" onClick={() => setWalkIn(true)}><UserPlus className="size-4" />{t("queue.walkIn")}</Button>}
        </div>
      </div>

      {appts.isLoading || docsQ.isLoading ? <Skeleton className="h-64" /> : groups.length === 0 ? (
        <EmptyState title={t("queue.queueEmpty")} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {groups.map(({ d, serving, waiting, expected }) => (
            <section key={d.id} className="rounded-lg border bg-card p-4 shadow-sm">
              <header className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{d.full_name}</h2>
                  <p className="text-sm text-muted-foreground">{d.specialty} · {t("queue.waitingCount", { count: waiting.length })}</p>
                </div>
                {hasRole("admin", "super_admin") && (
                  <Button size="sm" variant="ghost" onClick={() => copyTv(d.id)} title={t("queue.copyLink")}><Monitor className="size-4" />{t("queue.tvScreen")}</Button>
                )}
              </header>
              <div className="mb-3 flex items-center justify-between rounded-md bg-primary/10 px-3 py-2">
                <span className="text-sm">{t("queue.nowServing")}</span>
                <span className="text-2xl font-bold text-primary"><Ltr>{serving?.token_no ?? t("queue.none")}</Ltr></span>
              </div>
              <h3 className="mb-1 text-xs font-medium uppercase text-muted-foreground">{t("queue.waiting")}</h3>
              {waiting.length === 0 ? <p className="mb-3 text-sm text-muted-foreground">{t("queue.queueEmpty")}</p> : (
                <ul className="mb-3 divide-y">
                  {waiting.map((a, i) => (
                    <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="w-10 text-lg font-semibold"><Ltr>{a.token_no}</Ltr></span>
                      <span className="flex-1 truncate">{a.patients?.full_name} <Ltr className="text-xs text-muted-foreground">{a.patients?.mrn}</Ltr></span>
                      <span className="text-muted-foreground">{t("queue.estWait", { min: avg * (i + (serving ? 1 : 0)) })}</span>
                      <Button size="icon" variant="ghost" className="size-7" title={t("queue.noShow")} disabled={busy === a.id}
                        onClick={() => window.confirm(t("queue.noShowConfirm", { token: a.token_no })) && run(a.id, "mark-no-show", { appointment_id: a.id })}>
                        <X className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {isReception && expected.length > 0 && (
                <>
                  <h3 className="mb-1 text-xs font-medium uppercase text-muted-foreground">{t("queue.expected")}</h3>
                  <ul className="divide-y">
                    {expected.map((a) => (
                      <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                        <Ltr className="w-12 text-muted-foreground">{pkTime(a.slot_start)}</Ltr>
                        <span className="w-8 font-medium"><Ltr>{a.token_no}</Ltr></span>
                        <span className="flex-1 truncate">{a.patients?.full_name}</span>
                        <Button size="sm" disabled={busy === a.id}
                          onClick={() => run(a.id, "check-in-appointment", { appointment_id: a.id }, () => t("queue.checkedIn"))}>{t("queue.checkIn")}</Button>
                        {new Date(a.slot_start).getTime() < Date.now() && (
                          <Button size="sm" variant="ghost" disabled={busy === a.id}
                            onClick={() => window.confirm(t("queue.noShowConfirm", { token: a.token_no })) && run(a.id, "mark-no-show", { appointment_id: a.id })}>{t("queue.noShow")}</Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ))}
        </div>
      )}
      <WalkInPanel open={walkIn} onOpenChange={setWalkIn} doctors={docsQ.data ?? []} onDone={() => void appts.refetch()} />
    </div>
  );
}

function WalkInPanel({ open, onOpenChange, doctors, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; doctors: { id: string; full_name: string; specialty: string }[]; onDone: () => void;
}) {
  const { t } = useTranslation();
  const [patient, setPatient] = useState<{ id: string; full_name: string; mrn: string } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [saving, setSaving] = useState(false);
  const close = (o: boolean) => { if (!o) { setPatient(null); setDoctorId(""); } onOpenChange(o); };
  const save = async () => {
    if (!patient || !doctorId) return;
    setSaving(true);
    try {
      const a = await callEdgeFunction<{ token_no: number }>("create-walk-in", { patient_id: patient.id, doctor_id: doctorId });
      toast.success(t("queue.walkInDone", { token: a.token_no }));
      onDone(); close(false);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? t("errors.generic"));
    } finally { setSaving(false); }
  };
  return (
    <SidePanel open={open} onOpenChange={close} title={t("queue.walkInTitle")}
      footer={<Button onClick={save} disabled={!patient || !doctorId || saving}>{t("queue.add")}</Button>}>
      <div className="space-y-4">
        <div className="space-y-1">
          <Label>{t("queue.pickPatient")}</Label>
          {patient ? (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{patient.full_name} · <Ltr className="text-muted-foreground">{patient.mrn}</Ltr></span>
              <Button size="icon" variant="ghost" className="size-7" onClick={() => setPatient(null)}><X className="size-4" /></Button>
            </div>
          ) : <PatientPicker onPick={setPatient} />}
        </div>
        <div className="space-y-1">
          <Label>{t("queue.pickDoctor")}</Label>
          <Select value={doctorId} onValueChange={setDoctorId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name} · {d.specialty}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
    </SidePanel>
  );
}
