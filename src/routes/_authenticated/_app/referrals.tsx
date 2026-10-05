import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Plus, Printer } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { DataTable, type Column } from "@/components/mc/data-table";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { ReferralFormPanel, ReferralLetter, ReferralStatusPanel } from "@/components/mc/referral-panels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMyContext } from "@/hooks/use-my-context";
import { REFERRAL_NEXT, REFERRAL_STATUS, REFERRAL_TONE, REFERRAL_WRITE_ROLES, useReferrals, type Referral } from "@/lib/referrals";

export const Route = createFileRoute("/_authenticated/_app/referrals")({
  head: () => ({ meta: [
    { title: "Referrals — MediCore HMS" },
    { name: "description", content: "Incoming and outgoing patient referrals with printable referral letters." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("referrals")}>
      <ReferralsPage />
    </RequireRole>
  ),
});

const when = (iso: string) => new Date(iso).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" });

function ReferralsPage() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const canWrite = REFERRAL_WRITE_ROLES.some((r) => hasRole(r as never));
  const [tab, setTab] = useState<"out" | "in">("out");
  const [form, setForm] = useState(false);
  const [letter, setLetter] = useState<Referral | null>(null);
  const [status, setStatus] = useState<Referral | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">{t("ref.title")}</h1><p className="text-sm text-muted-foreground">{t("ref.desc")}</p></div>
        {canWrite && <Button onClick={() => setForm(true)}><Plus /> {t("ref.new")}</Button>}
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "out" | "in")}>
        <TabsList><TabsTrigger value="out">{t("ref.dir.out")}</TabsTrigger><TabsTrigger value="in">{t("ref.dir.in")}</TabsTrigger></TabsList>
        {(["out", "in"] as const).map((d) => (
          <TabsContent key={d} value={d}>
            <ReferralTable direction={d} canWrite={canWrite} onLetter={setLetter} onStatus={setStatus} />
          </TabsContent>
        ))}
      </Tabs>
      {form && <ReferralFormPanel direction={tab} onClose={() => setForm(false)} onSaved={(r) => r.direction === "out" && setLetter(r)} />}
      {letter && <ReferralLetter r={letter} onClose={() => setLetter(null)} />}
      {status && <ReferralStatusPanel r={status} onClose={() => setStatus(null)} />}
    </div>
  );
}

function ReferralTable({ direction, canWrite, onLetter, onStatus }: { direction: "in" | "out"; canWrite: boolean; onLetter: (r: Referral) => void; onStatus: (r: Referral) => void }) {
  const { t } = useTranslation();
  const q = useReferrals(direction);
  if (q.isLoading) return <Skeleton className="h-64" />;
  const rows = (q.data ?? []).map((r) => ({ ...r, patient: r.patients?.full_name ?? "", mrn: r.patients?.mrn ?? "", facility: direction === "out" ? r.to_facility : r.from_facility }));
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "created_at", header: t("ref.col.date"), sortable: true, render: (r) => <Ltr className="text-xs">{when(r.created_at)}</Ltr> },
    { key: "patient", header: t("ref.col.patient"), sortable: true, render: (r) => <div><p className="font-medium">{r.patient}</p><Ltr className="font-mono text-xs text-muted-foreground">{r.mrn}</Ltr></div> },
    { key: "facility", header: t("ref.col.facility"), sortable: true, render: (r) => <Ltr>{r.facility}</Ltr> },
    { key: "reason", header: t("ref.col.reason"), render: (r) => <span className="line-clamp-2 text-sm">{r.reason}</span> },
    { key: "urgency", header: t("ref.col.urgency"), render: (r) => <StatusChip status={r.urgency === "routine" ? "inactive" : r.urgency === "urgent" ? "warning" : "urgent"}>{t(`ref.urg.${r.urgency}`)}</StatusChip> },
    { key: "status", header: t("ref.col.status"), render: (r) => <div><StatusChip status={REFERRAL_TONE[r.status] ?? "progress"}>{t(`ref.status.${r.status}`)}</StatusChip>
      {r.status_note && <p className="mt-1 text-xs text-muted-foreground">{r.status_note}</p>}</div> },
    { key: "id", header: t("ref.col.actions"), render: (r) => (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => onLetter(r)}><Printer /> {t("ref.letter")}</Button>
        {canWrite && (REFERRAL_NEXT[r.status] ?? []).length > 0 && <Button size="sm" variant="outline" onClick={() => onStatus(r)}>{t("ref.updateStatus")}</Button>}
      </div>
    ) },
  ];
  if (!rows.length) return <p className="py-10 text-center text-sm text-muted-foreground">{t("ref.none")}</p>;
  return <DataTable rows={rows} columns={columns} searchKeys={["patient", "mrn", "facility"]} pageSize={20}
    filters={[{ key: "status", label: t("ref.col.status"), options: REFERRAL_STATUS.map((s) => ({ value: s, label: t(`ref.status.${s}`) })) }]} />;
}
