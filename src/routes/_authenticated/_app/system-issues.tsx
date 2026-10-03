import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { DataTable, type Column } from "@/components/mc/data-table";
import { SidePanel } from "@/components/mc/side-panel";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useDateTimeFormat, useHospitalPeople } from "@/hooks/use-hospital-people";

export const Route = createFileRoute("/_authenticated/_app/system-issues")({
  head: () => ({ meta: [{ title: "System issues — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("systemIssues")}>
      <IssuesPage />
    </RequireRole>
  ),
});

type Row = {
  id: string; created_at: string; page: string; function_name: string; user_id: string;
  userName: string; message: string; stack: string | null;
};

function IssuesPage() {
  const { t, i18n } = useTranslation();
  const fmt = useDateTimeFormat(i18n.language);
  const { nameOf } = useHospitalPeople();
  const [days, setDays] = useState("7");
  const [open, setOpen] = useState<Row | null>(null);

  const q = useQuery({
    queryKey: ["error-logs", days],
    queryFn: async () => {
      const since = new Date(Date.now() - Number(days) * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("error_logs")
        .select("id, created_at, page, function_name, user_id, message, stack")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data;
    },
  });

  const rows: Row[] = (q.data ?? []).map((r) => ({
    ...r,
    page: r.page ?? "—",
    function_name: r.function_name ?? "—",
    user_id: r.user_id ?? "",
    userName: r.user_id ? nameOf(r.user_id) : t("issues.system"),
  }));
  const opts = (k: "page" | "function_name") =>
    [...new Set(rows.map((r) => r[k]))].sort().map((v) => ({ value: v, label: v }));

  const columns: Column<Row>[] = [
    { key: "created_at", header: t("issues.when"), sortable: true, render: (r) => <Ltr>{fmt.format(new Date(r.created_at))}</Ltr> },
    { key: "message", header: t("issues.message"), render: (r) => <span className="line-clamp-2 max-w-md">{r.message}</span> },
    { key: "page", header: t("issues.page"), render: (r) => <Ltr>{r.page}</Ltr> },
    { key: "function_name", header: t("issues.function"), render: (r) => <Ltr>{r.function_name}</Ltr> },
    { key: "userName", header: t("issues.user"), sortable: true },
    { key: "id", header: "", render: (r) => <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>{t("audit.open")}</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label>{t("issues.days")}</Label>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["1", "7", "30", "90"].map((d) => <SelectItem key={d} value={d}>{t(`issues.d${d}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {q.isError ? (
        <Banner tone="danger" title={t("issues.loadError")} />
      ) : q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          searchKeys={["message", "page", "function_name", "userName"]}
          pageSize={20}
          filters={[
            { key: "page", label: t("issues.page"), options: opts("page") },
            { key: "function_name", label: t("issues.function"), options: opts("function_name") },
          ]}
        />
      )}
      <SidePanel open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={t("issues.details")}>
        {open && (
          <div className="space-y-3 text-sm">
            <p className="font-medium">{open.message}</p>
            <p className="text-muted-foreground">
              <Ltr>{fmt.format(new Date(open.created_at))}</Ltr> · {open.userName} · <Ltr>{open.page}</Ltr> · <Ltr>{open.function_name}</Ltr>
            </p>
            {open.stack && (
              <>
                <Label>{t("issues.stack")}</Label>
                <pre dir="ltr" className="max-h-96 overflow-auto rounded-staff bg-muted p-3 text-xs">{open.stack}</pre>
              </>
            )}
          </div>
        )}
      </SidePanel>
    </div>
  );
}
