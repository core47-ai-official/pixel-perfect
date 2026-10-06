import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { supabase } from "@/integrations/supabase/client";
import { pkDay, pkTime, useMyPatient } from "@/lib/portal";
import { NotLinked } from "./book";

export const Route = createFileRoute("/_authenticated/portal/appointments")({
  head: () => ({ meta: [{ title: "My appointments — Patient portal" }, { name: "description", content: "Your upcoming and past hospital appointments." }] }),
  component: Appointments,
});

function Appointments() {
  const { t } = useTranslation();
  const me = useMyPatient();
  const q = useQuery({
    queryKey: ["portal", "appointments", me.data?.id], enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("appointments").select("id, slot_start, token_no, status").eq("patient_id", me.data!.id).order("slot_start", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as { id: string; slot_start: string; token_no: number | null; status: string }[];
    },
  });
  if (me.isLoading || q.isLoading) return <Skeleton className="h-40 rounded-patient" />;
  if (!me.data) return <NotLinked />;
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t("portal.nav.appointments")}</h1>
      {!q.data?.length ? <PCard><p className="text-muted-foreground">{t("portal.noAppts")}</p></PCard> : q.data.map((a) => (
        <PCard key={a.id} className="flex items-center justify-between gap-2">
          <div><p className="font-medium"><Ltr>{pkDay(a.slot_start)} · {pkTime(a.slot_start)}</Ltr></p>
            {a.token_no != null && <p className="text-sm text-muted-foreground">{t("portal.token")} <Ltr>{a.token_no}</Ltr></p>}</div>
          <span className="rounded-full border px-3 py-0.5 text-xs">{t(`portal.apptStatus.${a.status}`, { defaultValue: a.status })}</span>
        </PCard>
      ))}
    </div>
  );
}
