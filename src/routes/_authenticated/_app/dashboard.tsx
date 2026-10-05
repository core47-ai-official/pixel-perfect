import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { GripVertical, LayoutGrid, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Banner } from "@/components/mc/banner";
import { EmptyState } from "@/components/mc/empty-state";
import { SidePanel } from "@/components/mc/side-panel";
import { callEdgeFunction, useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import {
  MAX_WIDGETS, SIZE_CLASS, defaultLayoutFor, findWidget, widgetsForRoles,
  type LayoutItem, type WidgetSize,
} from "@/config/widgets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — MediCore HMS" },
      { name: "description", content: "Your MediCore HMS dashboard with widgets for your role." },
    ],
  }),
  component: Dashboard,
});

const DASHBOARD = "home";
type RangeKey = "today" | "7d" | "30d" | "month";

function rangeOf(key: RangeKey) {
  const to = new Date();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (key === "7d") from.setDate(from.getDate() - 6);
  if (key === "30d") from.setDate(from.getDate() - 29);
  if (key === "month") from.setDate(1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function useWide() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const on = () => setOk(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, []);
  return ok;
}

function Dashboard() {
  const { t } = useTranslation();
  const { context } = useMyContext();
  const roles = context?.roles ?? [];
  const navigate = useNavigate();
  // Doctors' home is "My day".
  useEffect(() => {
    if (roles.length && roles.every((r) => r === "doctor")) void navigate({ to: "/my-day", replace: true });
  }, [roles, navigate]);
  const allowed = useMemo(() => widgetsForRoles(roles), [roles]);
  const wide = useWide();
  const [range, setRange] = useState<RangeKey>("today");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LayoutItem[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const layoutKey = ["dashboard-layout", DASHBOARD, context?.profile?.id ?? null];
  const layoutQ = useQuery({
    queryKey: layoutKey,
    enabled: !!context?.profile,
    retry: false,
    queryFn: () => callEdgeFunction<{ widgets: LayoutItem[] }>("get-dashboard-layout", { dashboard: DASHBOARD }),
  });
  const fallback = defaultLayoutFor(roles);
  const saved = (layoutQ.data?.widgets ?? (layoutQ.isError ? fallback : []))
    .filter((w) => allowed.some((a) => a.id === w.id));
  const shown = editing ? draft : saved;

  const save = useEdgeFunction<unknown, { dashboard: string; widgets: LayoutItem[] }>("save-dashboard-layout", {
    invalidate: [layoutKey],
    successMessage: t("dash.saved"),
  });

  useEffect(() => { if (!wide) setEditing(false); }, [wide]);

  const startEdit = () => { setDraft(saved); setEditing(true); };
  const add = (id: string) => {
    if (draft.length >= MAX_WIDGETS) { toast.error(t("dash.max", { max: MAX_WIDGETS })); return; }
    const def = findWidget(id);
    if (def) setDraft([...draft, { id, size: def.defaultSize }]);
  };
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...draft];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setDraft(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">{t("auth.welcome", { name: context?.profile?.full_name ?? "" })}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="w-40" aria-label={t("dash.range")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["today", "7d", "30d", "month"] as const).map((k) => <SelectItem key={k} value={k}>{t(`dash.r.${k}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          {wide && !editing && allowed.length > 0 && (
            <Button variant="secondary" onClick={startEdit}><LayoutGrid /> {t("dash.manage")}</Button>
          )}
          {editing && (
            <>
              <Button variant="secondary" onClick={() => setLibraryOpen(true)}><Plus /> {t("dash.library")}</Button>
              <Button variant="ghost" onClick={() => setDraft(fallback)}><RotateCcw /> {t("dash.reset")}</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>{t("dash.cancel")}</Button>
              <Button
                disabled={save.isPending}
                onClick={() => save.mutate({ dashboard: DASHBOARD, widgets: draft }, { onSuccess: () => setEditing(false) })}
              >
                {t("dash.save")}
              </Button>
            </>
          )}
        </div>
      </div>

      {layoutQ.isError && <Banner tone="warning" title={t("dash.loadFailed")} />}
      {editing && <p className="text-sm text-muted-foreground">{t("dash.dragHint")}</p>}

      {layoutQ.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-4">
          {[0, 1].map((i) => <Skeleton key={i} className="h-32 rounded-staff" />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-staff border bg-card shadow-card">
          <EmptyState icon={LayoutGrid} title={t("dash.empty")} description={t("dash.emptyDesc")} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {shown.map((item, idx) => {
            const def = findWidget(item.id);
            if (!def) return null;
            return (
              <div
                key={item.id}
                className={cn(SIZE_CLASS[item.size], editing && "relative rounded-staff outline-2 outline-dashed outline-border", dragIdx === idx && "opacity-50")}
                draggable={editing}
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => editing && e.preventDefault()}
                onDrop={() => { if (dragIdx !== null) move(dragIdx, idx); setDragIdx(null); }}
                onDragEnd={() => setDragIdx(null)}
              >
                {editing && (
                  <div className="flex items-center gap-1 rounded-t-staff border-b bg-muted px-2 py-1 text-xs">
                    <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden />
                    <span className="flex-1 truncate font-medium">{t(def.title)}</span>
                    {def.sizes.map((s) => (
                      <Button
                        key={s} size="sm" variant={item.size === s ? "primary" : "ghost"} className="h-6 px-2 text-xs"
                        onClick={() => setDraft(draft.map((d, i) => (i === idx ? { ...d, size: s as WidgetSize } : d)))}
                      >
                        {t(`dash.${s}`)}
                      </Button>
                    ))}
                    <Button size="icon" variant="ghost" className="size-6" aria-label={t("dash.remove")}
                      onClick={() => setDraft(draft.filter((_, i) => i !== idx))}>
                      <X className="size-3.5" />
                    </Button>
                  </div>
                )}
                <WidgetBody id={item.id} size={item.size} range={range} userId={context?.profile?.id ?? null} />
              </div>
            );
          })}
        </div>
      )}

      <SidePanel open={libraryOpen} onOpenChange={setLibraryOpen} title={t("dash.library")} description={t("dash.libraryDesc", { max: MAX_WIDGETS })}>
        <ul className="space-y-2">
          {allowed.map((w) => {
            const on = draft.some((d) => d.id === w.id);
            return (
              <li key={w.id} className="flex items-start gap-3 rounded-staff border p-3">
                <w.icon className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
                <div className="flex-1">
                  <p className="text-sm font-medium">{t(w.title)}</p>
                  <p className="text-xs text-muted-foreground">{t(w.description)}</p>
                </div>
                <Button size="sm" variant={on ? "ghost" : "secondary"} disabled={on} onClick={() => add(w.id)}>
                  {on ? t("dash.added") : t("dash.add")}
                </Button>
              </li>
            );
          })}
        </ul>
      </SidePanel>
    </div>
  );

}

function WidgetBody({ id, size, range, userId }: { id: string; size: WidgetSize; range: RangeKey; userId: string | null }) {
  const { t } = useTranslation();
  const def = findWidget(id)!;
  const q = useQuery({
    queryKey: ["widget-data", id, range, userId],
    enabled: !!userId,
    retry: false,
    queryFn: () => callEdgeFunction<unknown>("get-widget-data", { widget_id: id, ...rangeOf(range) }),
  });
  if (q.isLoading) return <Skeleton className="h-32 rounded-staff" />;
  if (q.isError || q.data === undefined) {
    return (
      <div className="rounded-staff border bg-card p-5 shadow-card">
        <p className="text-sm text-muted-foreground">{t(def.title)}</p>
        <p className="mt-2 text-sm text-destructive">{t("dash.widgetFailed")}</p>
      </div>
    );
  }
  const C = def.component;
  return <C data={q.data} size={size} />;
}
