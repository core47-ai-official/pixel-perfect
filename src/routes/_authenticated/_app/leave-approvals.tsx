import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { DataTable, type Column } from "@/components/mc/data-table";
import { StatusChip } from "@/components/mc/status-chip";
import { ConfirmDialog } from "@/components/mc/confirm-dialog";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { useDepartmentsData } from "@/lib/departments-data";
import { LEAVE_TONE, useLeaves, type Leave } from "@/lib/doctor-leaves";

export const Route = createFileRoute("/_authenticated/_app/leave-approvals")({
  head: () => ({ meta: [{ title: "Leave approvals — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("leaveApprovals")}>
      <Approvals />
    </RequireRole>
  ),
});

type Row = Leave & { name: string; deptName: string; departmentId: string; range: string };

function Approvals() {
  const { t } = useTranslation();
  const { context, hasRole } = useMyContext();
  const isAdmin = hasRole("admin") || hasRole("super_admin");
  const { depts, doctors, people } = useDepartmentsData();
  const leaves = useLeaves(context?.hospital?.id);
  const [deciding, setDeciding] = useState<{ row: Row; decision: "approved" | "rejected" } | null>(null);
  const decide = useEdgeFunction<unknown, { leave_id: string; decision: string; note: string }>("decide-leave", {
    invalidate: [["doctor-leaves"], ["doctors"]],
  });

  const rows: Row[] = (leaves.data ?? []).flatMap((l) => {
    const d = doctors.data?.find((x) => x.id === l.doctor_id);
    if (!d) return [];
    // Department heads see only their own department.
    if (!isAdmin && d.department_id !== context?.department?.id) return [];
    return [{
      ...l, departmentId: d.department_id ?? "",
      name: people.data?.find((p) => p.id === d.user_id)?.full_name ?? "—",
      deptName: depts.data?.find((x) => x.id === d.department_id)?.name ?? "—",
      range: `${l.from_date} → ${l.to_date}`,
    }];
  }).sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1));

  const columns: Column<Row>[] = [
    { key: "name", header: t("doc.name"), sortable: true, render: (r) => <span className="font-medium">{r.name}</span> },
    { key: "deptName", header: t("doc.department"), sortable: true },
    { key: "range", header: t("leave.dates"), sortable: true, render: (r) => <Ltr>{r.range}</Ltr> },
    { key: "type", header: t("leave.type"), render: (r) => t(`leave.types.${r.type}`, { defaultValue: r.type }) },
    { key: "reason", header: t("leave.reason"), render: (r) => <span className="line-clamp-2 max-w-xs">{r.reason}</span> },
    {
      key: "status", header: t("doc.status"), sortable: true,
      render: (r) => (
        <div className="space-y-1">
          <StatusChip status={LEAVE_TONE[r.status]}>{t(`leave.status.${r.status}`)}</StatusChip>
          {r.status === "approved" && r.affected_appointments > 0 && (
            <div className="text-xs text-muted-foreground">{t("leave.affected", { count: r.affected_appointments })}</div>
          )}
        </div>
      ),
    },
    {
      key: "id", header: "",
      render: (r) => r.status === "pending" ? (
        <div className="flex gap-1">
          <Button size="sm" onClick={() => setDeciding({ row: r, decision: "approved" })}><Check className="size-4" />{t("leave.approve")}</Button>
          <Button size="sm" variant="outline" onClick={() => setDeciding({ row: r, decision: "rejected" })}><X className="size-4" />{t("leave.reject")}</Button>
        </div>
      ) : null,
    },
  ];

  if (leaves.isLoading || doctors.isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("leave.approvalsIntro")}</p>
      <DataTable rows={rows} columns={columns} searchKeys={["name", "deptName", "reason"]}
        filters={[{ key: "status", label: t("doc.status"), options: (["pending", "approved", "rejected"] as const).map((s) => ({ value: s, label: t(`leave.status.${s}`) })) }]} />
      {deciding && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeciding(null)}
          title={deciding.decision === "approved" ? t("leave.approveTitle", { name: deciding.row.name }) : t("leave.rejectTitle", { name: deciding.row.name })}
          description={deciding.decision === "approved" ? t("leave.approveBody") : t("leave.rejectBody")}
          confirmLabel={deciding.decision === "approved" ? t("leave.approve") : t("leave.reject")}
          destructive={deciding.decision === "rejected"}
          onConfirm={(note: string) => decide.mutateAsync({ leave_id: deciding.row.id, decision: deciding.decision, note }).then(() => {
            setDeciding(null);
          })}
        />
      )}
    </div>
  );
}
