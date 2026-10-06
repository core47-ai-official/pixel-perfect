import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Banknote } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { supabase } from "@/integrations/supabase/client";
import { formatPkr } from "@/lib/patient-summary";
import { pkDay, useMyPatient } from "@/lib/portal";
import { NotLinked } from "./book";

export const Route = createFileRoute("/_authenticated/portal/bills")({
  head: () => ({ meta: [{ title: "My bills — Patient portal" }, { name: "description", content: "Your hospital bills, payments and balance." }] }),
  component: Bills,
});

interface Inv {
  id: string; invoice_no: string | null; created_at: string; status: string; total: number; paid: number; discount: number; balance: number;
  invoice_lines: { id: string; description: string; amount: number }[];
}

function Bills() {
  const { t } = useTranslation();
  const me = useMyPatient();
  const q = useQuery({
    queryKey: ["portal", "bills", me.data?.id], enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices")
        .select("id, invoice_no, created_at, status, total, paid, discount, balance, invoice_lines(id, description, amount)")
        .eq("patient_id", me.data!.id).neq("status", "cancelled").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Inv[];
    },
  });
  if (me.isLoading || q.isLoading) return <Skeleton className="h-40 rounded-patient" />;
  if (!me.data) return <NotLinked />;
  const due = (q.data ?? []).reduce((s, i) => s + Number(i.balance ?? 0), 0);
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t("portal.nav.bills")}</h1>
      <Banner tone="info" title={t("portal.bills.payNote")} />
      <PCard className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium"><Banknote className="size-4" aria-hidden />{t("portal.bills.due")}</span>
        <Ltr className="text-lg font-semibold">{formatPkr(due)}</Ltr>
      </PCard>
      {!q.data?.length ? <PCard><p className="text-muted-foreground">{t("portal.bills.none")}</p></PCard> : q.data.map((i) => (
        <PCard key={i.id} className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Ltr className="font-medium">{i.invoice_no ?? "—"}</Ltr>
            <span className="text-sm text-muted-foreground"><Ltr>{pkDay(i.created_at)}</Ltr></span>
          </div>
          <ul className="space-y-0.5 text-sm">
            {i.invoice_lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-2"><span className="min-w-0 truncate" dir="auto">{l.description}</span><Ltr>{formatPkr(l.amount)}</Ltr></li>
            ))}
          </ul>
          <dl className="grid grid-cols-3 gap-2 border-t pt-2 text-sm">
            <div><dt className="text-muted-foreground">{t("portal.bills.total")}</dt><dd><Ltr>{formatPkr(i.total)}</Ltr></dd></div>
            <div><dt className="text-muted-foreground">{t("portal.bills.paid")}</dt><dd><Ltr>{formatPkr(i.paid)}</Ltr></dd></div>
            <div><dt className="text-muted-foreground">{t("portal.bills.balance")}</dt><dd className={Number(i.balance) > 0 ? "font-semibold" : ""}><Ltr>{formatPkr(i.balance)}</Ltr></dd></div>
          </dl>
        </PCard>
      ))}
    </div>
  );
}
