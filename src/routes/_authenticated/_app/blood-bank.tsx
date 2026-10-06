import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Droplet, Plus } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { EmptyState } from "@/components/mc/empty-state";
import { SidePanel } from "@/components/mc/side-panel";
import { BloodRequestPanel, RegisterUnitPanel, RequestPanel, UnitActionPanel } from "@/components/mc/blood-panels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMyContext } from "@/hooks/use-my-context";
import {
  BLOOD_GROUPS, COMPONENTS, REQ_STATUS_TONE, URGENCY_TONE, bloodExpiryTone, fmtWhen, hoursLeft, useBloodRequests, useBloodUnits,
  type BloodRequest, type BloodUnit,
} from "@/lib/blood";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/blood-bank")({
  head: () => ({ meta: [
    { title: "Blood bank — MediCore HMS" },
    { name: "description", content: "Blood inventory by group and component, expiry, crossmatch and issue." },
    { property: "og:title", content: "Blood bank — MediCore HMS" },
    { property: "og:description", content: "Blood inventory by group and component, expiry, crossmatch and issue." },
  ] }),
  component: () => <RequireRole roles={rolesForPage("bloodBank")}><BloodBankPage /></RequireRole>,
});

const URG_RANK: Record<string, number> = { emergency: 0, urgent: 1, routine: 2 };

function BloodBankPage() {
  const { t } = useTranslation();
  const { context } = useMyContext();
  const roles = (context?.roles ?? []).map((r) => (typeof r === "string" ? r : (r as { role: string }).role));
  const canBank = roles.some((r) => ["super_admin", "admin", "lab_tech"].includes(r));
  const canRequest = roles.some((r) => ["super_admin", "admin", "doctor", "er_officer"].includes(r));
  const units = useBloodUnits();
  const reqs = useBloodRequests();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [cell, setCell] = useState<{ group: string; component: string } | null>(null);
  const [openReq, setOpenReq] = useState<BloodRequest | null>(null);
  const [actUnit, setActUnit] = useState<BloodUnit | null>(null);

  const stock = units.data?.stock ?? [];
  const live = useMemo(() => stock.filter((u) => hoursLeft(u.expires_at) > 0), [stock]);
  const queue = useMemo(() => [...(reqs.data ?? [])].sort((a, b) => {
    const open = (x: BloodRequest) => (["issued", "cancelled"].includes(x.status) ? 1 : 0);
    return open(a) - open(b) || (URG_RANK[a.urgency] ?? 3) - (URG_RANK[b.urgency] ?? 3) || a.created_at.localeCompare(b.created_at);
  }), [reqs.data]);
  const pending = queue.filter((r) => !["issued", "cancelled"].includes(r.status)).length;
  const current = openReq ? reqs.data?.find((r) => r.id === openReq.id) ?? openReq : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("bb.title")}</h1>
        <div className="flex gap-2">
          {canRequest && <Button variant="outline" onClick={() => setRequestOpen(true)}><Droplet />{t("bb.newRequest")}</Button>}
          {canBank && <Button onClick={() => setRegisterOpen(true)}><Plus />{t("bb.register")}</Button>}
        </div>
      </div>
      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">{t("bb.board")}</TabsTrigger>
          <TabsTrigger value="requests">{t("bb.requests")}{pending > 0 && <span className="ms-1.5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground"><Ltr>{pending}</Ltr></span>}</TabsTrigger>
          <TabsTrigger value="history">{t("bb.history")}</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="space-y-3 pt-3">
          {units.isLoading ? <Skeleton className="h-72" /> : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted"><tr>
                  <th className="p-2 text-start">{t("bb.group")}</th>
                  {COMPONENTS.map((c) => <th key={c} className="p-2 text-start">{t(`bb.components.${c}`)}</th>)}
                </tr></thead>
                <tbody>
                  {BLOOD_GROUPS.map((g) => (
                    <tr key={g} className="border-t">
                      <td className="p-2 text-lg font-bold"><Ltr>{g}</Ltr></td>
                      {COMPONENTS.map((c) => {
                        const list = live.filter((u) => u.blood_group === g && u.component === c);
                        const avail = list.filter((u) => u.status === "available");
                        const soonest = avail[0]?.expires_at;
                        const tone = soonest ? bloodExpiryTone(soonest) : null;
                        return (
                          <td key={c} className="p-1.5">
                            <button type="button" onClick={() => setCell({ group: g, component: c })}
                              className={cn("w-full rounded-md border p-2 text-start transition-colors hover:bg-muted",
                                !avail.length && "bg-urgent-soft/40", tone === "urgent" && "border-urgent", tone === "warning" && "border-warning")}>
                              <span className="block text-xl font-semibold"><Ltr>{avail.length}</Ltr></span>
                              <span className="block text-xs text-muted-foreground">
                                {list.length - avail.length > 0 && <>{t("bb.reservedN", { n: list.length - avail.length })} · </>}
                                {soonest ? <>{t("bb.nextExpiry")} <Ltr>{fmtWhen(soonest)}</Ltr></> : t("bb.none")}
                              </span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <StatusChip status="urgent">{t("bb.legendRed")}</StatusChip><StatusChip status="warning">{t("bb.legendAmber")}</StatusChip>
            {stock.length > live.length && <StatusChip status="urgent">{t("bb.expiredInStock", { n: stock.length - live.length })}</StatusChip>}
          </p>
        </TabsContent>

        <TabsContent value="requests" className="space-y-2 pt-3">
          {reqs.isLoading ? <Skeleton className="h-40" /> : !queue.length ? <EmptyState icon={Droplet} title={t("bb.noRequests")} /> : queue.map((r) => (
            <button key={r.id} type="button" onClick={() => setOpenReq(r)}
              className={cn("flex w-full flex-wrap items-center gap-3 rounded-lg border p-3 text-start hover:bg-muted", r.urgency === "emergency" && !["issued", "cancelled"].includes(r.status) && "border-urgent")}>
              <span className="text-lg font-bold"><Ltr>{r.blood_group}</Ltr></span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.patients?.full_name} <Ltr className="font-mono text-xs text-muted-foreground">{r.patients?.mrn}</Ltr></p>
                <p className="text-xs text-muted-foreground">{t(`bb.components.${r.component}`)} × <Ltr>{r.units}</Ltr> · <Ltr>{fmtWhen(r.created_at)}</Ltr>{r.emergency_case_id && <> · {t("bb.fromEr")}</>}</p>
              </div>
              <StatusChip status={URGENCY_TONE[r.urgency] ?? "inactive"}>{t(`bb.urgencies.${r.urgency}`)}</StatusChip>
              <StatusChip status={REQ_STATUS_TONE[r.status] ?? "inactive"}>{t(`bb.reqStatus.${r.status}`)}</StatusChip>
            </button>
          ))}
        </TabsContent>

        <TabsContent value="history" className="space-y-2 pt-3">
          {!units.data?.history.length ? <EmptyState icon={Droplet} title={t("bb.noHistory")} /> : units.data.history.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
              <Ltr className="font-mono font-semibold">{u.unit_no}</Ltr><Ltr>{u.blood_group}</Ltr><span>{t(`bb.components.${u.component}`)}</span>
              <StatusChip status={u.status === "issued" ? "ok" : "inactive"}>{t(`bb.unitStatus.${u.status}`)}</StatusChip>
              {u.discard_reason && <span className="text-muted-foreground" dir="auto">{u.discard_reason}</span>}
              {u.issued_at && <Ltr className="text-muted-foreground">{fmtWhen(u.issued_at)}</Ltr>}
              {canBank && u.status === "issued" && <Button size="sm" variant="outline" className="ms-auto" onClick={() => setActUnit(u)}>{t("bb.return")}</Button>}
            </div>
          ))}
        </TabsContent>
      </Tabs>

      {cell && (
        <SidePanel open onOpenChange={(o) => !o && setCell(null)} title={`${cell.group} · ${t(`bb.components.${cell.component}`)}`}>
          <div className="space-y-2 text-sm">
            {stock.filter((u) => u.blood_group === cell.group && u.component === cell.component).map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div>
                  <Ltr className="font-mono font-semibold">{u.unit_no}</Ltr> <StatusChip status={u.status === "available" ? "ok" : "progress"}>{t(`bb.unitStatus.${u.status}`)}</StatusChip>
                  <div className="mt-1"><StatusChip status={bloodExpiryTone(u.expires_at)}>{hoursLeft(u.expires_at) <= 0 ? t("bb.expired") : t("bb.expiresAt")} <Ltr>{fmtWhen(u.expires_at)}</Ltr></StatusChip></div>
                </div>
                {canBank && <Button size="sm" variant="outline" onClick={() => setActUnit(u)}>{t("bb.discard")}</Button>}
              </div>
            ))}
            {!stock.some((u) => u.blood_group === cell.group && u.component === cell.component) && <p className="text-muted-foreground">{t("bb.none")}</p>}
          </div>
        </SidePanel>
      )}
      {registerOpen && <RegisterUnitPanel onClose={() => setRegisterOpen(false)} />}
      {requestOpen && <BloodRequestPanel onClose={() => setRequestOpen(false)} />}
      {current && <RequestPanel r={current} units={stock} canBank={canBank} onClose={() => setOpenReq(null)} />}
      {actUnit && <UnitActionPanel u={actUnit} onClose={() => setActUnit(null)} />}
    </div>
  );
}
