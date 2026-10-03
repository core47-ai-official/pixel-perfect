import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { DataTable, type Column } from "@/components/mc/data-table";
import { SidePanel } from "@/components/mc/side-panel";
import { Banner } from "@/components/mc/banner";
import { StatusChip, type Status } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useDateTimeFormat, useHospitalPeople } from "@/hooks/use-hospital-people";

export const Route = createFileRoute("/_authenticated/_app/support-tickets")({
  head: () => ({ meta: [{ title: "Support tickets — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("supportTickets")}>
      <TicketsPage />
    </RequireRole>
  ),
});

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
const TONE: Record<string, Status> = { open: "warning", in_progress: "progress", resolved: "ok", closed: "inactive" };
const KEY = ["support-tickets"];

type Row = {
  id: string; created_at: string; page: string; description: string; screenshot_url: string | null;
  status: string; assigned_to: string | null; raised_by: string; raisedName: string; assignedName: string;
};

function TicketsPage() {
  const { t, i18n } = useTranslation();
  const fmt = useDateTimeFormat(i18n.language);
  const { nameOf } = useHospitalPeople();
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("id, created_at, page, description, screenshot_url, status, assigned_to, raised_by")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data;
    },
  });
  const rows: Row[] = (q.data ?? []).map((r) => ({
    ...r,
    page: r.page ?? "—",
    raisedName: nameOf(r.raised_by),
    assignedName: r.assigned_to ? nameOf(r.assigned_to) : t("tickets.unassigned"),
  }));
  const open = rows.find((r) => r.id === openId) ?? null;

  const columns: Column<Row>[] = [
    { key: "created_at", header: t("tickets.when"), sortable: true, render: (r) => <Ltr>{fmt.format(new Date(r.created_at))}</Ltr> },
    { key: "description", header: t("tickets.description"), render: (r) => <span className="line-clamp-2 max-w-md">{r.description}</span> },
    { key: "page", header: t("tickets.page"), render: (r) => <Ltr>{r.page}</Ltr> },
    { key: "raisedName", header: t("tickets.raisedBy"), sortable: true },
    { key: "status", header: t("tickets.status"), sortable: true, render: (r) => <StatusChip status={TONE[r.status] ?? "inactive"}>{t(`tickets.st_${r.status}`)}</StatusChip> },
    { key: "assignedName", header: t("tickets.assignedTo"), sortable: true },
    { key: "id", header: "", render: (r) => <Button size="sm" variant="ghost" onClick={() => setOpenId(r.id)}>{t("audit.open")}</Button> },
  ];

  return (
    <div className="space-y-4">
      {q.isError ? (
        <Banner tone="danger" title={t("tickets.loadError")} />
      ) : q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          searchKeys={["description", "page", "raisedName"]}
          pageSize={20}
          filters={[{ key: "status", label: t("tickets.status"), options: STATUSES.map((s) => ({ value: s, label: t(`tickets.st_${s}`) })) }]}
        />
      )}
      {open && <TicketPanel key={open.id} ticket={open} onClose={() => setOpenId(null)} when={fmt.format(new Date(open.created_at))} />}
    </div>
  );
}

function TicketPanel({ ticket, onClose, when }: { ticket: Row; onClose: () => void; when: string }) {
  const { t } = useTranslation();
  const { people } = useHospitalPeople();
  const [status, setStatus] = useState(ticket.status);
  const [assigned, setAssigned] = useState(ticket.assigned_to ?? "none");
  const [shot, setShot] = useState<string | null>(null);
  const save = useEdgeFunction("update-support-ticket", { invalidate: [KEY], successMessage: t("tickets.saved") });

  useEffect(() => {
    if (!ticket.screenshot_url) return;
    supabase.storage.from("tickets").createSignedUrl(ticket.screenshot_url, 600).then(({ data }) => setShot(data?.signedUrl ?? null));
  }, [ticket.screenshot_url]);

  return (
    <SidePanel
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("tickets.details")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("users.cancel")}</Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                { ticket_id: ticket.id, status, assigned_to: assigned === "none" ? null : assigned },
                { onSuccess: onClose },
              )
            }
          >
            {t("tickets.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground"><Ltr>{when}</Ltr> · {ticket.raisedName} · <Ltr>{ticket.page}</Ltr></p>
        <p className="whitespace-pre-wrap">{ticket.description}</p>
        <div className="space-y-1.5">
          <Label>{t("tickets.screenshot")}</Label>
          {!ticket.screenshot_url ? (
            <p className="text-muted-foreground">{t("tickets.noScreenshot")}</p>
          ) : shot ? (
            <a href={shot} target="_blank" rel="noreferrer"><img src={shot} alt="" className="max-h-72 rounded-staff border" /></a>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </div>
        <div className="space-y-1.5">
          <Label>{t("tickets.status")}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`tickets.st_${s}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("tickets.assignedTo")}</Label>
          <Select value={assigned} onValueChange={setAssigned}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("tickets.unassigned")}</SelectItem>
              {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    </SidePanel>
  );
}
