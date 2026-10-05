import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Pill } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { EmptyState } from "@/components/mc/empty-state";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMyContext } from "@/hooks/use-my-context";
import { useRxQueue, useRxRealtime } from "@/lib/dispensing";

export const Route = createFileRoute("/_authenticated/_app/pharmacy")({
  head: () => ({ meta: [
    { title: "Pharmacy queue — MediCore HMS" },
    { name: "description", content: "Prescriptions waiting to be dispensed, updated live." },
    { property: "og:title", content: "Pharmacy queue — MediCore HMS" },
    { property: "og:description", content: "Prescriptions waiting to be dispensed, updated live." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("pharmacy")}>
      <QueuePage />
    </RequireRole>
  ),
});

function QueuePage() {
  const { t } = useTranslation();
  const { context } = useMyContext();
  const hid = context?.hospital?.id;
  useRxRealtime(hid);
  const q = useRxQueue(hid);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("rx.queue")}</h1>
        <p className="text-sm text-muted-foreground">{t("rx.queueHint")}</p>
      </div>
      {q.isLoading ? <Skeleton className="h-40 w-full" /> : !q.data?.length ? (
        <EmptyState icon={Pill} title={t("rx.empty")} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("rx.patient")}</TableHead><TableHead>{t("rx.items")}</TableHead>
              <TableHead>{t("rx.written")}</TableHead><TableHead>{t("rx.status")}</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {q.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><div className="font-medium">{r.patients?.full_name}</div><div className="text-xs text-muted-foreground"><Ltr>{r.patients?.mrn}</Ltr></div></TableCell>
                  <TableCell><Ltr>{r.prescription_items.length}</Ltr></TableCell>
                  <TableCell><Ltr>{new Date(r.created_at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}</Ltr></TableCell>
                  <TableCell><Badge variant={r.status === "active" ? "secondary" : "outline"}>{t(`rx.st_${r.status}`)}</Badge></TableCell>
                  <TableCell className="text-end">
                    <Button asChild size="sm"><Link to="/pharmacy/$prescriptionId" params={{ prescriptionId: r.id }}>{t("rx.open")}</Link></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
