import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ScrollText } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { SidePanel } from "@/components/mc/side-panel";
import { Banner } from "@/components/mc/banner";
import { EmptyState } from "@/components/mc/empty-state";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useDateTimeFormat, useHospitalPeople } from "@/hooks/use-hospital-people";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/audit-logs")({
  head: () => ({ meta: [{ title: "Audit log — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("auditLogs")}>
      <AuditPage />
    </RequireRole>
  ),
});

interface AuditEntry {
  id: string; created_at: string; user_id: string | null; impersonated_by: string | null;
  action: string; resource: string; resource_id: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null; ip: string | null;
}
interface Filters { user_id: string; patient: string; resource: string; action: string; from: string; to: string }
const EMPTY: Filters = { user_id: "", patient: "", resource: "", action: "", from: "", to: "" };
const PAGE_SIZE = 25;

function AuditPage() {
  const { t, i18n } = useTranslation();
  const fmt = useDateTimeFormat(i18n.language);
  const { people, nameOf } = useHospitalPeople();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditEntry | null>(null);

  const q = useQuery({
    queryKey: ["audit-log", filters, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      callEdgeFunction<{ rows: AuditEntry[]; total: number }>("get-audit-log", {
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
        page,
        page_size: PAGE_SIZE,
      }),
  });
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const set = (k: keyof Filters) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 rounded-staff border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilters(draft);
        }}
      >
        <F label={t("audit.user")}>
          <Select value={draft.user_id || "all"} onValueChange={(v) => set("user_id")(v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("audit.anyUser")}</SelectItem>
              {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </F>
        <F label={t("audit.patient")}><Input dir="ltr" value={draft.patient} onChange={(e) => set("patient")(e.target.value)} /></F>
        <F label={t("audit.resource")}><Input dir="ltr" value={draft.resource} onChange={(e) => set("resource")(e.target.value)} placeholder="patient, invoice…" /></F>
        <F label={t("audit.action")}><Input dir="ltr" value={draft.action} onChange={(e) => set("action")(e.target.value)} placeholder="create, update…" /></F>
        <F label={t("audit.from")}><Input type="date" dir="ltr" value={draft.from} onChange={(e) => set("from")(e.target.value)} /></F>
        <F label={t("audit.to")}><Input type="date" dir="ltr" value={draft.to} onChange={(e) => set("to")(e.target.value)} /></F>
        <div className="flex items-end gap-2 lg:col-span-2">
          <Button type="submit">{t("audit.apply")}</Button>
          <Button type="button" variant="ghost" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); setPage(1); }}>{t("audit.clear")}</Button>
        </div>
      </form>

      {q.isError ? (
        <Banner tone="danger" title={t("audit.loadError")}>{(q.error as { message?: string })?.message}</Banner>
      ) : q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : !q.data?.rows.length ? (
        <EmptyState icon={ScrollText} title={t("audit.empty")} />
      ) : (
        <div className="overflow-hidden rounded-staff border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("audit.when")}</TableHead>
                <TableHead>{t("audit.by")}</TableHead>
                <TableHead>{t("audit.action")}</TableHead>
                <TableHead>{t("audit.resource")}</TableHead>
                <TableHead>{t("audit.record")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen(r)}>
                  <TableCell className="py-[var(--cell-py)]"><Ltr>{fmt.format(new Date(r.created_at))}</Ltr></TableCell>
                  <TableCell>
                    {nameOf(r.user_id)}
                    {r.impersonated_by && <span className="ms-1 text-xs text-urgent-fg">({nameOf(r.impersonated_by)})</span>}
                  </TableCell>
                  <TableCell><Ltr>{r.action}</Ltr></TableCell>
                  <TableCell><Ltr>{r.resource}</Ltr></TableCell>
                  <TableCell><Ltr className="text-muted-foreground">{r.resource_id ?? "—"}</Ltr></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t p-3 text-sm">
            <span className="text-muted-foreground">{t("audit.page", { n: page })} / <Ltr>{pages}</Ltr></span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("audit.prev")}</Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t("audit.next")}</Button>
            </div>
          </div>
        </div>
      )}

      <SidePanel open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={t("audit.details")}>
        {open && <AuditDetail entry={open} nameOf={nameOf} when={fmt.format(new Date(open.created_at))} />}
      </SidePanel>
    </div>
  );
}

function show(v: unknown) {
  if (v === undefined) return "—";
  if (v === null) return "null";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function AuditDetail({ entry, nameOf, when }: { entry: AuditEntry; nameOf: (id: string | null) => string; when: string }) {
  const { t } = useTranslation();
  const b = entry.before ?? {};
  const a = entry.after ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  const changed = keys.filter((k) => show(b[k]) !== show(a[k]));
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t("audit.when")}</dt><dd><Ltr>{when}</Ltr></dd>
        <dt className="text-muted-foreground">{t("audit.by")}</dt><dd>{nameOf(entry.user_id)}</dd>
        {entry.impersonated_by && (<><dt className="text-muted-foreground">{t("audit.impersonatedBy")}</dt><dd className="text-urgent-fg">{nameOf(entry.impersonated_by)}</dd></>)}
        <dt className="text-muted-foreground">{t("audit.action")}</dt><dd><Ltr>{entry.action}</Ltr></dd>
        <dt className="text-muted-foreground">{t("audit.resource")}</dt><dd><Ltr>{entry.resource} {entry.resource_id ?? ""}</Ltr></dd>
        {entry.ip && (<><dt className="text-muted-foreground">{t("audit.ip")}</dt><dd><Ltr>{entry.ip}</Ltr></dd></>)}
      </dl>
      {changed.length === 0 ? (
        <p className="text-muted-foreground">{t("audit.noChanges")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("audit.field")}</TableHead>
              <TableHead>{t("audit.before")}</TableHead>
              <TableHead>{t("audit.after")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changed.map((k) => (
              <TableRow key={k}>
                <TableCell className="font-medium"><Ltr>{k}</Ltr></TableCell>
                <TableCell className={cn("break-all bg-urgent-soft/60")}><Ltr>{show(b[k])}</Ltr></TableCell>
                <TableCell className="break-all bg-ok-soft/60"><Ltr>{show(a[k])}</Ltr></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
