import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarClock, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusChip } from "@/components/mc/status-chip";
import { supabase } from "@/integrations/supabase/client";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { DOCTOR_STATUSES, toneFor, useDoctorsRealtime } from "@/lib/doctor-status";

/** Top-bar status switch, shown only to people with a doctor profile. */
export function DoctorStatusSwitcher() {
  const { t } = useTranslation();
  const { context, hasRole } = useMyContext();
  const me = context?.profile?.id;
  const isDoctor = hasRole("doctor");
  const mine = useQuery({
    queryKey: ["doctors", "me", me],
    enabled: !!me && isDoctor,
    queryFn: async () => {
      const { data, error } = await supabase.from("doctors").select("id, status").eq("user_id", me!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useDoctorsRealtime(isDoctor ? context?.hospital?.id : undefined);
  const set = useEdgeFunction<unknown, { doctor_id: string; status: string }>("set-doctor-status", {
    invalidate: [["doctors"]], successMessage: t("sched.statusSaved"),
  });
  if (!isDoctor || !mine.data) return null;
  const current = mine.data.status;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1" disabled={set.isPending} aria-label={t("sched.myStatus")}>
          <StatusChip status={toneFor(current)}>{t(`doc.statuses.${current}`)}</StatusChip>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("sched.myStatus")}</DropdownMenuLabel>
        {DOCTOR_STATUSES.map((s) => (
          <DropdownMenuItem key={s} disabled={s === current} onSelect={() => set.mutate({ doctor_id: mine.data!.id, status: s })}>
            <StatusChip status={toneFor(s)}>{t(`doc.statuses.${s}`)}</StatusChip>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/doctors/$doctorId" params={{ doctorId: mine.data.id }}>
            <CalendarClock className="size-4" />{t("sched.mySchedule")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
