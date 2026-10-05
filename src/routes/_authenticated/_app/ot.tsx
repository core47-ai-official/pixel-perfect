import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { addDays, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { CalendarPlus, ExternalLink, Play, CheckCircle2, CalendarClock, Zap, Plus } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Calendar, type CalColumn, type CalEvent, type CalendarView } from "@/components/mc/calendar";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip, type Status } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { EmptyState } from "@/components/mc/empty-state";
import { OtBookingPanel, OtSchedulePanel } from "@/components/mc/ot-panels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { useBookableDoctors } from "@/lib/appointments";
import { caseEnd, OT_SCHEDULERS, OT_STATUSES, OT_TYPES, useOtBookings, useOtRealtime, useOtRequests, useTheatres, type OtBooking, type Theatre } from "@/lib/ot";

export const Route = createFileRoute("/_authenticated/_app/ot")({
  head: () => ({ meta: [
    { title: "Operation theatre — MediCore HMS" },
    { name: "description", content: "OT calendar by theatre, surgery requests and theatre setup." },
    { property: "og:title", content: "Operation theatre — MediCore HMS" },
    { property: "og:description", content: "OT calendar by theatre, surgery requests and theatre setup." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("ot")}>
      <OtPage />
    </RequireRole>
  ),
});

const TONE: Record<string, Status> = { requested: "caution", scheduled: "progress", in_progress: "warning", completed: "ok", cancelled: "inactive", bumped: "urgent" };

function OtPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { hasRole, context } = useMyContext();
  const canSchedule = hasRole(...OT_SCHEDULERS);
  const isAdmin = hasRole("super_admin", "admin");
  useOtRealtime(context?.hospital?.id);

  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<CalendarView>("byDoctor");
  const [from, to] = view === "month" ? [startOfWeek(startOfMonth(date), { weekStartsOn: 1 }), addDays(endOfWeek(endOfMonth(date), { weekStartsOn: 1 }), 1)]
    : view === "week" ? [startOfWeek(date, { weekStartsOn: 1 }), addDays(endOfWeek(date, { weekStartsOn: 1 }), 1)] : [date, addDays(date, 1)];
  const bookings = useOtBookings(startOfDay(from).toISOString(), startOfDay(to).toISOString());
  const requests = useOtRequests();
  const theatres = useTheatres();
  const docs = useBookableDoctors();
  const docName = (id: string | null) => (id ? docs.data?.find((d) => d.id === id)?.full_name ?? "—" : "—");
  const otName = (id: string | null) => theatres.data?.find((o) => o.id === id)?.name ?? "—";

  const [newOpen, setNewOpen] = useState<{ otId: string | null; start: Date | null } | null>(null);
  const [selected, setSelected] = useState<OtBooking | null>(null);
  const [scheduling, setScheduling] = useState<OtBooking | null>(null);
  const [bumping, setBumping] = useState<OtBooking | null>(null);
  const [tab, setTab] = useState("calendar");

  const byId = useMemo(() => new Map([...(bookings.data ?? []), ...(requests.data ?? [])].map((b) => [b.id, b])), [bookings.data, requests.data]);
  const events: CalEvent[] = (bookings.data ?? []).filter((b) => b.ot_id && b.planned_start).map((b) => ({
    id: b.id, start: new Date(b.planned_start!), end: caseEnd(b), title: b.procedure,
    subtitle: `${b.patients?.full_name ?? ""} · ${view === "byDoctor" ? docName(b.surgeon_id) : otName(b.ot_id)}`,
    columnId: b.ot_id!, colorKey: b.priority, status: b.status,
  }));
  const columns: CalColumn[] = (theatres.data ?? []).filter((o) => o.status !== "inactive").map((o) => ({
    id: o.id, label: o.name, sub: t(`ot.types.${o.type}`),
    blocked: [
      ...(o.status === "maintenance" ? [{ start: date, end: addDays(date, 1), label: t("ot.statuses.maintenance") }] : []),
      // Cleaning time after each case is shown hatched.
      ...(bookings.data ?? []).filter((b) => b.ot_id === o.id && b.planned_start && b.cleaning_minutes > 0)
        .map((b) => ({ start: caseEnd(b), end: new Date(caseEnd(b).getTime() + b.cleaning_minutes * 60_000), label: t("ot.cleaningShort") })),
    ],
  }));

  const act = async (fn: string, b: OtBooking) => {
    try {
      const r = await callEdgeFunction<{ charge_missing?: boolean }>(fn, { booking_id: b.id });
      toast.success(t(fn === "start-ot-case" ? "ot.started" : "ot.completed"));
      if (r?.charge_missing) toast.warning(t("ot.chargeMissing"));
      setSelected(null);
    } catch (e) { toast.error((e as EdgeError).message); }
    void qc.invalidateQueries({ queryKey: ["ot"] });
  };

  const reqCount = requests.data?.length ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{t("nav.ot")}</h1>
        <Button className="ms-auto" size="sm" onClick={() => setNewOpen({ otId: null, start: null })}><CalendarPlus className="size-4" />{t("quick.newOtBooking")}</Button>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="calendar">{t("ot.calendar")}</TabsTrigger>
          <TabsTrigger value="requests">{t("ot.requests")}{reqCount > 0 && <Badge variant="secondary" className="ms-1.5">{reqCount}</Badge>}</TabsTrigger>
          {isAdmin && <TabsTrigger value="theatres">{t("ot.theatres")}</TabsTrigger>}
        </TabsList>
        <TabsContent value="calendar" className="mt-4">
          {theatres.data && theatres.data.length === 0 ? <EmptyState title={t("ot.noTheatres")} /> : (
            <Calendar mode="otPriority" events={events} columns={columns} date={date} onDateChange={(d) => setDate(startOfDay(d))}
              view={view} onViewChange={setView} loading={bookings.isFetching} startHour={7} endHour={22}
              onSlotClick={canSchedule ? (start, columnId) => setNewOpen({ otId: columnId, start }) : undefined}
              onEventClick={(e) => setSelected(byId.get(e.id) ?? null)} />
          )}
          <p className="mt-2 text-xs text-muted-foreground">{t("ot.byTheatreHint")}</p>
        </TabsContent>
        <TabsContent value="requests" className="mt-4 space-y-2">
          {reqCount === 0 ? <EmptyState title={t("ot.noRequests")} /> : requests.data!.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-staff border bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.procedure}</span>
                  <StatusChip status={r.priority === "emergency" ? "urgent" : "ok"}>{t(`cal.legend.otPriority.${r.priority}`)}</StatusChip>
                  <StatusChip status={TONE[r.status] ?? "inactive"}>{t(`ot.bstatus.${r.status}`)}</StatusChip>
                </div>
                <p className="text-sm text-muted-foreground">
                  {r.patients?.full_name} <Ltr>{r.patients?.mrn}</Ltr> · {t("ot.surgeon")}: {docName(r.surgeon_id)} · <Ltr>{r.planned_minutes}+{r.cleaning_minutes} min</Ltr>
                  {r.planned_start && <> · {t("ot.preferredStart")}: <Ltr>{format(new Date(r.planned_start), "dd MMM HH:mm")}</Ltr></>}
                </p>
                {r.bump_reason && <p className="text-xs text-urgent-fg">{t("ot.bumpedBecause")}: {r.bump_reason}</p>}
              </div>
              {canSchedule && (
                <div className="flex gap-2">
                  {r.priority === "emergency" && <Button variant="outline" size="sm" onClick={() => setBumping(r)}><Zap className="size-4" />{t("ot.bump")}</Button>}
                  <Button size="sm" onClick={() => setScheduling(r)}><CalendarClock className="size-4" />{t("ot.schedule")}</Button>
                </div>
              )}
            </div>
          ))}
        </TabsContent>
        {isAdmin && <TabsContent value="theatres" className="mt-4"><TheatreSetup theatres={theatres.data ?? []} /></TabsContent>}
      </Tabs>

      <OtBookingPanel open={!!newOpen} onOpenChange={(o) => !o && setNewOpen(null)} initialOtId={newOpen?.otId} initialStart={newOpen?.start} />
      <OtSchedulePanel booking={scheduling} onOpenChange={(o) => !o && setScheduling(null)} />
      <BumpPanel emergency={bumping} onOpenChange={(o) => !o && setBumping(null)} docName={docName} otName={otName} />

      <SidePanel open={!!selected} onOpenChange={(o) => !o && setSelected(null)} title={t("cal.details")}
        footer={selected && (
          <>
            {canSchedule && selected.status === "scheduled" && <Button variant="outline" onClick={() => { setScheduling(selected); setSelected(null); }}><CalendarClock className="size-4" />{t("ot.reschedule")}</Button>}
            {selected.status === "scheduled" && <Button variant="outline" onClick={() => act("start-ot-case", selected)}><Play className="size-4" />{t("ot.start_case")}</Button>}
            {selected.status === "in_progress" && <Button variant="outline" onClick={() => act("complete-ot-case", selected)}><CheckCircle2 className="size-4" />{t("ot.complete_case")}</Button>}
            <Button asChild><Link to="/patients/$patientId" params={{ patientId: selected.patient_id }}><ExternalLink className="size-4" />{t("pat.openRecord")}</Link></Button>
          </>
        )}>
        {selected && (
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-lg font-semibold">{selected.procedure}</span>
              <StatusChip status={TONE[selected.status] ?? "inactive"}>{t(`ot.bstatus.${selected.status}`)}</StatusChip>
            </div>
            {[
              [t("ot.patient"), <span key="p">{selected.patients?.full_name} <Ltr className="text-muted-foreground">{selected.patients?.mrn}</Ltr></span>],
              [t("ot.theatre"), otName(selected.ot_id)],
              [t("ot.priority"), t(`cal.legend.otPriority.${selected.priority}`)],
              [t("ot.surgeon"), docName(selected.surgeon_id)],
              [t("ot.anesthetist"), docName(selected.anesthetist_id)],
              [t("ot.start"), selected.planned_start ? <Ltr key="s">{format(new Date(selected.planned_start), "dd MMM yyyy, HH:mm")}</Ltr> : "—"],
              [t("ot.minutes"), <Ltr key="m">{`${selected.planned_minutes} + ${selected.cleaning_minutes} min`}</Ltr>],
            ].map(([k, v], i) => <div key={i} className="grid grid-cols-[8rem_1fr] gap-2"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>)}
            {selected.note && <p className="text-muted-foreground">{selected.note}</p>}
          </dl>
        )}
      </SidePanel>
    </div>
  );
}

function BumpPanel({ emergency, onOpenChange, docName, otName }: { emergency: OtBooking | null; onOpenChange: (o: boolean) => void; docName: (id: string | null) => string; otName: (id: string | null) => string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const now = useMemo(() => new Date(), [emergency]); // eslint-disable-line react-hooks/exhaustive-deps
  const upcoming = useOtBookings(now.toISOString(), addDays(now, 7).toISOString(), !!emergency);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const electives = (upcoming.data ?? []).filter((b) => b.priority === "elective" && b.status === "scheduled");
  const submit = async () => {
    if (!emergency || !target || reason.trim().length < 5) { toast.error(t("ot.bumpNeeds")); return; }
    setBusy(true);
    try {
      await callEdgeFunction("bump-ot-booking", { emergency_booking_id: emergency.id, bumped_booking_id: target, reason });
      toast.success(t("ot.bumped")); setTarget(""); setReason(""); onOpenChange(false);
    } catch (e) { toast.error((e as EdgeError).message); }
    void qc.invalidateQueries({ queryKey: ["ot"] });
    setBusy(false);
  };
  return (
    <SidePanel open={!!emergency} onOpenChange={onOpenChange} title={t("ot.bumpTitle")}
      footer={<Button variant="destructive" onClick={submit} disabled={busy}><Zap className="size-4" />{t("ot.bump")}</Button>}>
      {emergency && (
        <div className="space-y-4 text-sm">
          <p><span className="font-semibold">{emergency.procedure}</span> — {emergency.patients?.full_name}</p>
          <div className="space-y-1.5">
            <Label>{t("ot.bumpWhich")}</Label>
            {electives.length === 0 ? <p className="text-muted-foreground">{t("ot.noElectives")}</p> : (
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger><SelectValue placeholder={t("ot.bumpWhich")} /></SelectTrigger>
                <SelectContent>
                  {electives.map((b) => <SelectItem key={b.id} value={b.id}>{format(new Date(b.planned_start!), "dd MMM HH:mm")} · {otName(b.ot_id)} · {b.procedure} ({docName(b.surgeon_id)})</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5"><Label>{t("ot.reason")}</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></div>
          <p className="text-xs text-muted-foreground">{t("ot.bumpHint")}</p>
        </div>
      )}
    </SidePanel>
  );
}

function TheatreSetup({ theatres }: { theatres: Theatre[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<Theatre> | null>(null);
  const save = async () => {
    if (!edit?.name?.trim()) return;
    try {
      await callEdgeFunction("upsert-ot", { id: edit.id, name: edit.name, type: edit.type ?? "major", status: edit.status ?? "active" });
      toast.success(t("ot.saved")); setEdit(null);
    } catch (e) { toast.error((e as EdgeError).message); }
    void qc.invalidateQueries({ queryKey: ["ot", "theatres"] });
  };
  return (
    <div className="space-y-3">
      <Button size="sm" onClick={() => setEdit({ type: "major", status: "active", name: "" })}><Plus className="size-4" />{t("ot.addTheatre")}</Button>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {theatres.map((o) => (
          <button key={o.id} type="button" onClick={() => setEdit(o)} className="rounded-staff border bg-card p-3 text-start hover:bg-accent">
            <div className="font-semibold">{o.name}</div>
            <div className="mt-1 flex gap-2 text-xs"><span className="text-muted-foreground">{t(`ot.types.${o.type}`)}</span>
              <StatusChip status={o.status === "active" ? "ok" : o.status === "maintenance" ? "warning" : "inactive"}>{t(`ot.statuses.${o.status}`)}</StatusChip></div>
          </button>
        ))}
      </div>
      <SidePanel open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? t("ot.editTheatre") : t("ot.addTheatre")}
        footer={<Button onClick={save}>{t("ot.save")}</Button>}>
        {edit && (
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>{t("ot.name")}</Label><Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={80} /></div>
            <div className="space-y-1.5"><Label>{t("ot.type")}</Label>
              <Select value={edit.type ?? "major"} onValueChange={(v) => setEdit({ ...edit, type: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{OT_TYPES.map((x) => <SelectItem key={x} value={x}>{t(`ot.types.${x}`)}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>{t("ot.status")}</Label>
              <Select value={edit.status ?? "active"} onValueChange={(v) => setEdit({ ...edit, status: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{OT_STATUSES.map((x) => <SelectItem key={x} value={x}>{t(`ot.statuses.${x}`)}</SelectItem>)}</SelectContent></Select></div>
          </div>
        )}
      </SidePanel>
    </div>
  );
}
