import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarClock, CalendarOff } from "lucide-react";
import { toast } from "sonner";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { StatusChip } from "@/components/mc/status-chip";
import { EmptyState } from "@/components/mc/empty-state";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { LEAVE_TONE, LEAVE_TYPES, todayISO, useLeaves } from "@/lib/doctor-leaves";

export const Route = createFileRoute("/_authenticated/_app/my-leave")({
  head: () => ({ meta: [{ title: "My schedule and leave — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("myLeave")}>
      <MyLeave />
    </RequireRole>
  ),
});

function MyLeave() {
  const { t } = useTranslation();
  const { context } = useMyContext();
  const me = context?.profile?.id;
  const hid = context?.hospital?.id;
  const doc = useQuery({
    queryKey: ["doctors", "me", me], enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase.from("doctors").select("id, status").eq("user_id", me!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const leaves = useLeaves(hid, doc.data?.id);
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [type, setType] = useState<string>("casual");
  const [reason, setReason] = useState("");
  const req = useEdgeFunction<unknown, { from_date: string; to_date: string; type: string; reason: string }>("request-leave", {
    invalidate: [["doctor-leaves"]], successMessage: t("leave.requested"),
  });

  if (doc.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!doc.data) return <EmptyState icon={CalendarOff} title={t("leave.noProfile")} description={t("leave.noProfileBody")} />;

  const submit = () => {
    if (!from || !to || to < from) { toast.error(t("leave.badDates")); return; }
    if (reason.trim().length < 3) { toast.error(t("leave.needReason")); return; }
    req.mutate({ from_date: from, to_date: to, type, reason: reason.trim() }, { onSuccess: () => setReason("") });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <Link to="/doctors/$doctorId" params={{ doctorId: doc.data.id }}
          className="flex items-center gap-3 rounded-staff border bg-card p-4 hover:bg-muted/50">
          <CalendarClock className="size-5 text-primary" />
          <div><div className="font-medium">{t("sched.weekly")}</div><div className="text-xs text-muted-foreground">{t("leave.editSchedule")}</div></div>
        </Link>
        <div className="space-y-3 rounded-staff border bg-card p-4">
          <h3 className="font-semibold">{t("leave.request")}</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>{t("leave.from")}</Label><Input dir="ltr" type="date" min={todayISO()} value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></div>
            <div className="space-y-1.5"><Label>{t("leave.to")}</Label><Input dir="ltr" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>{t("leave.type")}</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LEAVE_TYPES.map((v) => <SelectItem key={v} value={v}>{t(`leave.types.${v}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>{t("leave.reason")}</Label><Textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></div>
          <Button className="w-full" onClick={submit} disabled={req.isPending}>{t("leave.submit")}</Button>
        </div>
      </div>
      <div className="space-y-3">
        <h3 className="font-semibold">{t("leave.history")}</h3>
        {leaves.isLoading ? <Skeleton className="h-40 w-full" /> : (leaves.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("leave.none")}</p>
        ) : (leaves.data ?? []).map((l) => (
          <div key={l.id} className="flex flex-wrap items-start justify-between gap-2 rounded-staff border bg-card p-3">
            <div>
              <div className="font-medium"><Ltr>{l.from_date}</Ltr> → <Ltr>{l.to_date}</Ltr> · {t(`leave.types.${l.type}`, { defaultValue: l.type })}</div>
              <div className="text-sm text-muted-foreground">{l.reason}</div>
              {l.decision_note && <div className="mt-1 text-xs">{t("leave.note")}: {l.decision_note}</div>}
            </div>
            <StatusChip status={LEAVE_TONE[l.status]}>{t(`leave.status.${l.status}`)}</StatusChip>
          </div>
        ))}
      </div>
    </div>
  );
}
