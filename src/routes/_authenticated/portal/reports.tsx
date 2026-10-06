import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { supabase } from "@/integrations/supabase/client";
import { pkDay, useMyPatient } from "@/lib/portal";
import { NotLinked } from "./book";

export const Route = createFileRoute("/_authenticated/portal/reports")({
  head: () => ({ meta: [{ title: "My reports — Patient portal" }, { name: "description", content: "Your verified lab reports." }] }),
  component: Reports,
});

function Reports() {
  const { t } = useTranslation();
  const me = useMyPatient();
  const q = useQuery({
    queryKey: ["portal", "reports", me.data?.id], enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select("id, verified_at, lab_tests(name)").eq("patient_id", me.data!.id).eq("status", "verified").order("verified_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; verified_at: string | null; lab_tests: { name: string } | null }[];
    },
  });
  if (me.isLoading || q.isLoading) return <Skeleton className="h-40 rounded-patient" />;
  if (!me.data) return <NotLinked />;
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t("portal.nav.reports")}</h1>
      {!q.data?.length ? <PCard><p className="text-muted-foreground">{t("portal.noReports")}</p></PCard> : q.data.map((o) => (
        <PCard key={o.id} className="flex items-center justify-between gap-2">
          <Ltr className="font-medium">{o.lab_tests?.name ?? "—"}</Ltr>
          <span className="text-sm text-muted-foreground"><Ltr>{o.verified_at ? pkDay(o.verified_at) : ""}</Ltr></span>
        </PCard>
      ))}
    </div>
  );
}
