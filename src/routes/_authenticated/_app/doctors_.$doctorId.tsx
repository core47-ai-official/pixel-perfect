import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext, type AppRole } from "@/hooks/use-my-context";
import { useDepartmentsData } from "@/lib/departments-data";
import { toneFor, useDoctorsRealtime } from "@/lib/doctor-status";

const ROLES: AppRole[] = [...new Set<AppRole>([...rolesForPage("doctors"), "doctor"])];

export const Route = createFileRoute("/_authenticated/_app/doctors_/$doctorId")({
  head: () => ({ meta: [{ title: "Doctor profile — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={ROLES}>
      <DoctorProfile />
    </RequireRole>
  ),
});

interface Slot { start_time: string; end_time: string; slot_minutes: number; max_patients: number | null; room: string }
// Monday-first display; weekday numbers follow JS (0 = Sunday).
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const pkr = (n: number) => `Rs ${Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

function DoctorProfile() {
  const { doctorId } = Route.useParams();
  const { t } = useTranslation();
  const { context, hasRole } = useMyContext();
  useDoctorsRealtime(context?.hospital?.id);
  const { depts, doctors, people } = useDepartmentsData();
  const doc = doctors.data?.find((d) => d.id === doctorId);

  const sched = useQuery({
    queryKey: ["doctor-schedules", doctorId],
    queryFn: async () => {
      const { data, error } = await supabase.from("doctor_schedules")
        .select("weekday, start_time, end_time, slot_minutes, max_patients, room").eq("doctor_id", doctorId).order("start_time");
      if (error) throw error;
      return data;
    },
  });

  const [week, setWeek] = useState<Record<number, Slot[]>>({});
  useEffect(() => {
    if (!sched.data) return;
    const w: Record<number, Slot[]> = {};
    for (const r of sched.data) (w[r.weekday] ??= []).push({
      start_time: r.start_time.slice(0, 5), end_time: r.end_time.slice(0, 5), slot_minutes: r.slot_minutes,
      max_patients: r.max_patients, room: r.room ?? "",
    });
    setWeek(w);
  }, [sched.data]);

  const save = useEdgeFunction<unknown, { doctor_id: string; slots: (Slot & { weekday: number })[] }>("save-doctor-schedule", {
    invalidate: [["doctor-schedules"]], successMessage: t("sched.saved"),
  });

  if (doctors.isLoading || sched.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!doc) return <p className="text-sm text-muted-foreground">{t("sched.notFound")}</p>;

  const canEdit = hasRole("super_admin") || hasRole("admin") || doc.user_id === context?.profile?.id
    || (hasRole("dept_head") && !!doc.department_id && context?.department?.id === doc.department_id);
  const name = people.data?.find((p) => p.id === doc.user_id)?.full_name ?? t("doc.name");
  const dept = depts.data?.find((d) => d.id === doc.department_id)?.name ?? "—";

  const update = (wd: number, i: number, patch: Partial<Slot>) =>
    setWeek((w) => ({ ...w, [wd]: (w[wd] ?? []).map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const add = (wd: number) => setWeek((w) => {
    const last = w[wd]?.at(-1);
    return { ...w, [wd]: [...(w[wd] ?? []), { start_time: last?.end_time ?? "09:00", end_time: "13:00", slot_minutes: last?.slot_minutes ?? 15, max_patients: null, room: last?.room ?? "" }] };
  });
  const remove = (wd: number, i: number) => setWeek((w) => ({ ...w, [wd]: (w[wd] ?? []).filter((_, j) => j !== i) }));

  const submit = () => {
    const slots = WEEK.flatMap((wd) => (week[wd] ?? []).map((s) => ({ ...s, weekday: wd })));
    for (const wd of WEEK) {
      const day = [...(week[wd] ?? [])].sort((a, b) => a.start_time.localeCompare(b.start_time));
      for (let i = 0; i < day.length; i++) {
        const s = day[i]!;
        if (!s.start_time || !s.end_time || s.end_time <= s.start_time) { toast.error(t("sched.badRange")); return; }
        if (!(s.slot_minutes >= 5 && s.slot_minutes <= 240)) { toast.error(t("sched.badSlot")); return; }
        if (i > 0 && s.start_time < day[i - 1]!.end_time) { toast.error(t("sched.overlap")); return; }
      }
    }
    save.mutate({ doctor_id: doc.id, slots });
  };

  return (
    <div className="space-y-6">
      <Link to="/doctors" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" />{t("sched.back")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-staff border bg-card p-5">
        <div>
          <h2 className="text-xl font-semibold">{name}</h2>
          <p className="text-sm text-muted-foreground">{[dept, doc.specialty].filter(Boolean).join(" · ")}</p>
          <p className="mt-2 text-sm">
            {t("doc.fee")}: <Ltr className="tnum">{pkr(doc.consultation_fee)}</Ltr> · {t("doc.followupFee")}: <Ltr className="tnum">{pkr(doc.followup_fee)}</Ltr>
            {doc.pmdc_no && <> · {t("doc.pmdc")}: <Ltr>{doc.pmdc_no}</Ltr></>}
          </p>
        </div>
        <StatusChip status={toneFor(doc.status)}>{t(`doc.statuses.${doc.status}`)}</StatusChip>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{t("sched.weekly")}</h3>
          {canEdit && <Button onClick={submit} disabled={save.isPending}>{t("dept.save")}</Button>}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {WEEK.map((wd) => (
            <div key={wd} className="space-y-2 rounded-staff border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{t(`sched.days.${wd}`)}</span>
                {canEdit && <Button size="icon" variant="ghost" className="size-7" onClick={() => add(wd)} aria-label={t("sched.addHours")}><Plus className="size-4" /></Button>}
              </div>
              {(week[wd] ?? []).length === 0 && <p className="text-xs text-muted-foreground">{t("sched.off")}</p>}
              {(week[wd] ?? []).map((s, i) => (
                <div key={i} className="space-y-1.5 rounded-md bg-muted/50 p-2" dir="ltr">
                  <div className="flex items-center gap-1">
                    <Input type="time" className="h-8" value={s.start_time} disabled={!canEdit} onChange={(e) => update(wd, i, { start_time: e.target.value })} />
                    <span>–</span>
                    <Input type="time" className="h-8" value={s.end_time} disabled={!canEdit} onChange={(e) => update(wd, i, { end_time: e.target.value })} />
                    {canEdit && <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => remove(wd, i)} aria-label={t("sched.remove")}><Trash2 className="size-3.5" /></Button>}
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <label className="text-[11px] text-muted-foreground">{t("sched.slot")}
                      <Input type="number" min={5} max={240} className="h-7" value={s.slot_minutes} disabled={!canEdit} onChange={(e) => update(wd, i, { slot_minutes: Number(e.target.value) })} /></label>
                    <label className="text-[11px] text-muted-foreground">{t("sched.max")}
                      <Input type="number" min={1} className="h-7" value={s.max_patients ?? ""} disabled={!canEdit} onChange={(e) => update(wd, i, { max_patients: e.target.value ? Number(e.target.value) : null })} /></label>
                    <label className="text-[11px] text-muted-foreground">{t("sched.room")}
                      <Input className="h-7" value={s.room} maxLength={30} disabled={!canEdit} onChange={(e) => update(wd, i, { room: e.target.value })} /></label>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
