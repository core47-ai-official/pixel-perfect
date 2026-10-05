import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, RotateCcw, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusChip } from "@/components/mc/status-chip";
import { CODE_DEFAULTS, MAX_WIDGETS, WIDGETS, type LayoutItem, type WidgetSize } from "@/config/widgets";
import type { AppRole } from "@/hooks/use-my-context";

const ROLES: AppRole[] = ["admin", "dept_head", "doctor", "nurse", "er_officer", "receptionist", "cashier", "pharmacist", "lab_tech", "ot_coordinator", "super_admin"];
export const ROLE_DASHBOARDS_KEY = ["role-dashboards"];

/** Company settings → Dashboards: default widget layout per role. */
export function useRoleDashboards() {
  return useQuery({
    queryKey: ROLE_DASHBOARDS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from("company_settings").select("dashboards" as never).maybeSingle();
      if (error) throw error;
      return ((data as { dashboards?: Record<string, LayoutItem[]> } | null)?.dashboards ?? {}) as Partial<Record<string, LayoutItem[]>>;
    },
  });
}

export function RoleDashboardsTab({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const saved = useRoleDashboards();
  const [role, setRole] = useState<AppRole>("admin");
  const [items, setItems] = useState<LayoutItem[]>([]);
  const [busy, setBusy] = useState(false);
  const custom = !!saved.data?.[role];
  useEffect(() => { setItems(saved.data?.[role] ?? CODE_DEFAULTS[role] ?? []); }, [role, saved.data]);
  const available = useMemo(() => WIDGETS.filter((w) => w.roles.includes(role)), [role]);

  const toggle = (id: string, on: boolean) => {
    if (on) {
      if (items.length >= MAX_WIDGETS) { toast.error(t("dash.max", { max: MAX_WIDGETS })); return; }
      const def = WIDGETS.find((w) => w.id === id)!;
      setItems([...items, { id, size: def.defaultSize }]);
    } else setItems(items.filter((i) => i.id !== id));
  };
  const move = (i: number, d: -1 | 1) => {
    const n = [...items]; const j = i + d; if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j]!, n[i]!]; setItems(n);
  };
  const send = async (widgets: LayoutItem[] | null) => {
    setBusy(true);
    try {
      await callEdgeFunction("save-role-dashboards", { role, widgets });
      toast.success(t("cs.dash.saved"));
      void qc.invalidateQueries({ queryKey: ROLE_DASHBOARDS_KEY });
      void qc.invalidateQueries({ queryKey: ["dashboard-layout"] });
    } catch (e) { toast.error((e as { message?: string }).message ?? t("errors.generic")); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("cs.dash.intro")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label>{t("cs.dash.role")}</Label>
          <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{t(`roles.${r}`, r)}</SelectItem>)}</SelectContent>
          </Select></div>
        <StatusChip status={custom ? "progress" : "inactive"}>{custom ? t("cs.dash.custom") : t("cs.dash.builtIn")}</StatusChip>
      </div>
      {available.length === 0 ? <p className="text-sm text-muted-foreground">{t("dash.empty")}</p> : (
        <ul className="space-y-2">
          {[...items.map((i) => i.id), ...available.filter((w) => !items.some((i) => i.id === w.id)).map((w) => w.id)].map((id) => {
            const def = WIDGETS.find((w) => w.id === id)!;
            const idx = items.findIndex((i) => i.id === id);
            const on = idx >= 0;
            return (
              <li key={id} className="flex flex-wrap items-center gap-3 rounded-staff border p-2">
                <Checkbox checked={on} disabled={!canEdit} onCheckedChange={(v) => toggle(id, !!v)} aria-label={t(def.title)} />
                <def.icon className="size-4 text-muted-foreground" aria-hidden />
                <div className="min-w-40 flex-1"><p className="text-sm font-medium">{t(def.title)}</p><p className="text-xs text-muted-foreground">{t(def.description)}</p></div>
                {on && <>
                  <Select value={items[idx]!.size} disabled={!canEdit} onValueChange={(v) => setItems(items.map((x, j) => (j === idx ? { ...x, size: v as WidgetSize } : x)))}>
                    <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>{def.sizes.map((s) => <SelectItem key={s} value={s}>{t(`dash.${s}`)}</SelectItem>)}</SelectContent>
                  </Select>
                  {canEdit && <>
                    <Button size="icon" variant="ghost" className="size-8" aria-label="Up" onClick={() => move(idx, -1)}><ArrowUp /></Button>
                    <Button size="icon" variant="ghost" className="size-8" aria-label="Down" onClick={() => move(idx, 1)}><ArrowDown /></Button>
                  </>}
                </>}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void send(items)}><Save /> {t("cs.dash.save")}</Button>
          {custom && <Button variant="ghost" disabled={busy} onClick={() => void send(null)}><RotateCcw /> {t("cs.dash.reset")}</Button>}
        </div>
      )}
    </div>
  );
}
