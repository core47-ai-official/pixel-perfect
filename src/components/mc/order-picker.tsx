import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FlaskConical, Search, X } from "lucide-react";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/mc/status-chip";
import { ConfirmDialog } from "@/components/mc/confirm-dialog";
import { Ltr } from "@/components/mc/ltr";
import { LAB_PANELS, STATUS_TONE, useLabTests, useVisitOrders, type LabOrder } from "@/lib/lab";
import { cn } from "@/lib/utils";

export function OrderPicker({ visitId, canEdit }: { visitId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const tests = useLabTests();
  const orders = useVisitOrders(visitId);
  const [picked, setPicked] = useState<string[]>([]);
  const [urgent, setUrgent] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<LabOrder | null>(null);

  const active = (tests.data ?? []).filter((x) => x.is_active);
  const byCode = new Map(active.map((x) => [x.code.toUpperCase(), x]));
  const ordered = new Set((orders.data ?? []).filter((o) => o.status !== "cancelled").map((o) => o.test_id));
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 1) return [];
    return active.filter((x) => `${x.code} ${x.name}`.toLowerCase().includes(s) && !picked.includes(x.id)).slice(0, 15);
  }, [q, active, picked]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const addPanel = (codes: readonly string[]) => {
    const ids = codes.map((c) => byCode.get(c)?.id).filter((x): x is string => !!x && !ordered.has(x));
    setPicked((p) => [...new Set([...p, ...ids])]);
  };
  const total = picked.reduce((s, id) => s + (active.find((x) => x.id === id)?.price ?? 0), 0);

  const submit = async () => {
    setBusy(true);
    try {
      await callEdgeFunction("create-orders", { visit_id: visitId, test_ids: picked, priority: urgent ? "urgent" : "routine" });
      setPicked([]); setUrgent(false);
      await qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success(t("lab.ordered"));
    } catch (e) { toast.error((e as EdgeError).message ?? t("errors.generic")); } finally { setBusy(false); }
  };

  return (
    <section className="rounded-lg border bg-card p-4 text-sm">
      <h2 className="mb-3 flex items-center gap-2 font-semibold"><FlaskConical className="size-4" />{t("consult.orders")}</h2>

      {canEdit && (
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap gap-1">
            {LAB_PANELS.filter((p) => p.codes.some((c) => byCode.has(c))).map((p) => (
              <button key={p.id} type="button" onClick={() => addPanel(p.codes)} className="rounded-full border bg-muted px-2.5 py-0.5 text-xs hover:bg-accent">{t(`lab.panels.${p.id}`)}</button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input className="ps-8" role="combobox" aria-expanded={open} aria-label={t("lab.searchPh")} placeholder={t("lab.searchPh")} value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { e.preventDefault(); toggle(hits[0].id); setQ(""); } }} />
            {open && q.trim() && (
              <ul role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
                {hits.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">{t("lab.noMatch")}</li>}
                {hits.map((x) => (
                  <li key={x.id} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); toggle(x.id); setQ(""); }}
                    className={cn("flex cursor-pointer justify-between gap-2 rounded px-2 py-1.5 hover:bg-accent", ordered.has(x.id) && "opacity-50")}>
                    <span><Ltr className="font-mono font-semibold">{x.code}</Ltr> <Ltr>{x.name}</Ltr></span>
                    <span className="shrink-0 text-xs text-muted-foreground">{t(`lab.cat.${x.category}`)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {picked.length > 0 && (
            <>
              <ul className="flex flex-wrap gap-1.5">
                {picked.map((id) => { const x = active.find((y) => y.id === id); return x && (
                  <li key={id} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5">
                    <Ltr className="font-mono text-xs font-semibold">{x.code}</Ltr>
                    <button type="button" aria-label={t("dx.remove")} onClick={() => toggle(id)}><X className="size-3.5 text-muted-foreground" /></button>
                  </li>); })}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2"><Switch checked={urgent} onCheckedChange={setUrgent} /><Label>{t("lab.urgent")}</Label></label>
                <span className="text-muted-foreground">{t("lab.total")}: <Ltr>Rs {total.toLocaleString("en-PK")}</Ltr></span>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPicked([])}>{t("common.cancel")}</Button>
                <Button size="sm" onClick={submit} disabled={busy}>{t("lab.order", { count: picked.length })}</Button>
              </div>
            </>
          )}
        </div>
      )}

      {(orders.data ?? []).length === 0 ? <p className="text-muted-foreground">{t("lab.none")}</p> : (
        <ul className="divide-y">
          {(orders.data ?? []).map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className={cn(o.status === "cancelled" && "line-through opacity-60")}>
                <Ltr className="font-mono font-semibold">{o.test?.code}</Ltr> <Ltr>{o.test?.name}</Ltr>
                {o.priority === "urgent" && <span className="ms-1 text-xs font-semibold text-urgent">{t("lab.urgent")}</span>}
              </span>
              <span className="flex items-center gap-1">
                <StatusChip status={STATUS_TONE[o.status] ?? "inactive"}>{t(`lab.status.${o.status}`)}</StatusChip>
                {canEdit && ["ordered", "collected"].includes(o.status) && (
                  <Button size="icon" variant="ghost" className="size-7" aria-label={t("lab.cancelOrder")} onClick={() => setCancelling(o)}><X className="size-4" /></Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {cancelling && <CancelOrder order={cancelling} onClose={() => setCancelling(null)} />}
    </section>
  );
}

function CancelOrder({ order, onClose }: { order: LabOrder; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("lab.cancelTitle", { test: order.test?.code ?? "" })}
      description={order.test?.name ?? ""}
      confirmLabel={t("lab.cancelOrder")}
      danger
      onConfirm={async (reason: string) => {
        try {
          await callEdgeFunction("cancel-order", { order_id: order.id, reason });
          await qc.invalidateQueries({ queryKey: ["orders"] });
          onClose();
        } catch (e) { toast.error((e as EdgeError).message ?? t("errors.generic")); }
      }}
    />
  );
}
