import type React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wind, Activity, Radio } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { cn } from "@/lib/utils";
import {
  BED_STATUSES, BED_TILE, BED_TONE, WARD_GENDERS, WARD_TYPES, allowedBedActions, byLabel, useBeds, useWards,
  type Bed, type BedStatus, type Ward,
} from "@/lib/beds";

export const Route = createFileRoute("/_authenticated/_app/wards")({
  head: () => ({ meta: [{ title: "Bed board — MediCore HMS" }, { name: "description", content: "Live bed board by ward with status counts and quick actions." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("wards")}>
      <BedBoard />
    </RequireRole>
  ),
});

function BedBoard() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const isAdmin = hasRole("admin") || hasRole("super_admin");
  const canAct = isAdmin || hasRole("nurse");
  const wards = useWards();
  const beds = useBeds();
  const [type, setType] = useState("all");
  const [gender, setGender] = useState("all");
  const [status, setStatus] = useState<BedStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const shownWards = (wards.data ?? []).filter((w) => w.is_active && (type === "all" || w.type === type) && (gender === "all" || w.gender === gender));
  const wardIds = new Set(shownWards.map((w) => w.id));
  const inScope = (beds.data ?? []).filter((b) => wardIds.has(b.ward_id));
  const counts = useMemo(() => Object.fromEntries(BED_STATUSES.map((s) => [s, inScope.filter((b) => b.status === s).length])) as Record<BedStatus, number>, [inScope]);
  const open = (beds.data ?? []).find((b) => b.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onValueChange={setType}><SelectTrigger className="w-44" aria-label={t("wd.type")}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t("bb.allTypes")}</SelectItem>{WARD_TYPES.map((v) => <SelectItem key={v} value={v}>{t(`wd.types.${v}`)}</SelectItem>)}</SelectContent></Select>
        <Select value={gender} onValueChange={setGender}><SelectTrigger className="w-40" aria-label={t("wd.gender")}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t("bb.allGenders")}</SelectItem>{WARD_GENDERS.map((v) => <SelectItem key={v} value={v}>{t(`wd.genders.${v}`)}</SelectItem>)}</SelectContent></Select>
        <span className="ms-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Radio className="size-3.5 text-ok" />{t("bb.live")}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <CountButton label={t("bb.total")} value={inScope.length} active={status === "all"} onClick={() => setStatus("all")} className="bg-card" />
        {BED_STATUSES.map((s) => (
          <CountButton key={s} label={t(`wd.statuses.${s}`)} value={counts[s]} active={status === s} onClick={() => setStatus(status === s ? "all" : s)} className={BED_TILE[s]} />
        ))}
      </div>

      {wards.isLoading || beds.isLoading ? <Skeleton className="h-96" /> : shownWards.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">{t("bb.empty")}</div>
      ) : shownWards.map((w) => {
        const list = inScope.filter((b) => b.ward_id === w.id && (status === "all" || b.status === status)).sort(byLabel);
        const all = inScope.filter((b) => b.ward_id === w.id);
        if (status !== "all" && list.length === 0) return null;
        return (
          <section key={w.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-base font-semibold">{w.name}</h2>
              <span className="text-xs text-muted-foreground">{t(`wd.types.${w.type}`)} · {t(`wd.genders.${w.gender}`)}{w.floor ? <> · <Ltr>{w.floor}</Ltr></> : null}</span>
              <span className="ms-auto text-xs"><Ltr>{all.filter((b) => b.status === "free").length}/{all.length}</Ltr> {t("wd.free")}</span>
            </div>
            {list.length === 0 ? <p className="text-sm text-muted-foreground">{t("bb.noBeds")}</p> : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 xl:grid-cols-10">
                {list.map((b) => (
                  <button key={b.id} onClick={() => setOpenId(b.id)}
                    className={cn("flex min-h-20 flex-col items-start justify-between rounded-lg border-2 p-2 text-start transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", BED_TILE[b.status])}>
                    <Ltr className="font-mono text-base font-bold">{b.label}</Ltr>
                    <span className="text-xs font-medium leading-tight">{t(`wd.statuses.${b.status}`)}</span>
                    <span className="flex gap-1 opacity-80">{b.has_oxygen && <Wind className="size-3" aria-label={t("wd.oxygen")} />}{b.has_ventilator && <Activity className="size-3" aria-label={t("wd.ventilator")} />}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {open && <BedPanel bed={open} ward={(wards.data ?? []).find((w) => w.id === open.ward_id)} canAct={canAct} isAdmin={isAdmin} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function CountButton({ label, value, active, onClick, className }: { label: string; value: number; active: boolean; onClick: () => void; className: string }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={cn("rounded-lg border p-3 text-start", className, active && "ring-2 ring-ring")}>
      <div className="text-xs font-medium">{label}</div>
      <Ltr className="text-2xl font-bold">{value}</Ltr>
    </button>
  );
}

function BedPanel({ bed, ward, canAct, isAdmin, onClose }: { bed: Bed; ward: Ward | undefined; canAct: boolean; isAdmin: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useEdgeFunction("update-bed-status", { invalidate: [["beds"]], successMessage: t("bb.updated") });
  const actions = canAct ? allowedBedActions(bed.status, isAdmin) : [];
  const act = async (to: BedStatus) => {
    try { await update.mutateAsync({ bed_id: bed.id, status: to, expected_status: bed.status }); onClose(); } catch { /* shown */ }
  };
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-3 py-1.5 text-sm"><span className="text-muted-foreground">{k}</span><span>{v}</span></div>;
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={`${t("bb.bed")} ${bed.label}`}>
      <div className="space-y-4">
        <StatusChip status={BED_TONE[bed.status]}>{t(`wd.statuses.${bed.status}`)}</StatusChip>
        <div className="divide-y">
          {row(t("bb.ward"), ward?.name ?? "—")}
          {row(t("wd.class"), t(`wd.types.${bed.bed_class}`))}
          {row(t("wd.rate"), <Ltr>Rs {bed.daily_rate.toLocaleString("en-PK")}</Ltr>)}
          {row(t("wd.oxygen"), bed.has_oxygen ? t("bb.yes") : t("bb.no"))}
          {row(t("wd.ventilator"), bed.has_ventilator ? t("bb.yes") : t("bb.no"))}
          {row(t("bb.since"), <Ltr>{new Date(bed.updated_at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}</Ltr>)}
        </div>
        {bed.status === "occupied" && <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t("bb.occupiedNote")}</p>}
        {actions.length > 0 && (
          <div className="space-y-2">
            {actions.map((to) => (
              <Button key={to} className="w-full justify-start" variant={to === "free" ? "default" : "outline"} disabled={update.isPending} onClick={() => act(to)}>
                <span className={cn("me-2 inline-block size-3 rounded-full border-2", BED_TILE[to])} />{t(`bb.to.${to}`)}
              </Button>
            ))}
          </div>
        )}
        {!canAct && <p className="text-sm text-muted-foreground">{t("bb.viewOnly")}</p>}
      </div>
    </SidePanel>
  );
}
