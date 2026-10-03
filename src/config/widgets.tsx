/**
 * Dashboard widget registry: the only place widgets are defined.
 * The dashboard page, the widget library panel and the role checks all read from here.
 * get-dashboard-layout / save-dashboard-layout / get-widget-data must mirror ids + roles.
 */
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { StatCard } from "@/components/mc/stat-card";
import type { AppRole } from "@/hooks/use-my-context";

export type WidgetSize = "small" | "medium" | "wide";
export const MAX_WIDGETS = 12;

export interface WidgetProps<T = unknown> {
  data: T;
  size: WidgetSize;
}

export interface WidgetDef {
  id: string;
  /** i18n key */
  title: string;
  /** i18n key */
  description: string;
  icon: LucideIcon;
  roles: AppRole[];
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
  component: ComponentType<WidgetProps<any>>;
}

export interface LayoutItem { id: string; size: WidgetSize }

interface CountData { value: number; previous?: number }

function trendOf(d: CountData) {
  if (d.previous === undefined || d.previous === 0) return undefined;
  return Math.round(((d.value - d.previous) / d.previous) * 100);
}

function ActiveUsers({ data }: WidgetProps<CountData>) {
  const { t } = useTranslation();
  return <StatCard label={t("dash.w.activeUsers")} value={data.value} trend={trendOf(data)} caption={t("dash.w.activeUsersCap")} />;
}

function ErrorsToday({ data }: WidgetProps<CountData>) {
  const { t } = useTranslation();
  return <StatCard label={t("dash.w.errorsToday")} value={data.value} trend={trendOf(data)} caption={t("dash.w.errorsTodayCap")} />;
}

export const WIDGETS: WidgetDef[] = [
  {
    id: "active_users", title: "dash.w.activeUsers", description: "dash.w.activeUsersDesc", icon: Users,
    roles: ["super_admin", "admin"], sizes: ["small", "medium", "wide"], defaultSize: "small", component: ActiveUsers,
  },
  {
    id: "errors_today", title: "dash.w.errorsToday", description: "dash.w.errorsTodayDesc", icon: AlertTriangle,
    roles: ["super_admin"], sizes: ["small", "medium", "wide"], defaultSize: "small", component: ErrorsToday,
  },
];

export const findWidget = (id: string) => WIDGETS.find((w) => w.id === id);

export function widgetsForRoles(roles: AppRole[]) {
  return WIDGETS.filter((w) => w.roles.some((r) => roles.includes(r)));
}

/** Fallback when company settings have no role default (the server applies the same rule). */
export const CODE_DEFAULTS: Partial<Record<AppRole, LayoutItem[]>> = {
  super_admin: [{ id: "active_users", size: "small" }, { id: "errors_today", size: "small" }],
  admin: [{ id: "active_users", size: "small" }],
};

export function defaultLayoutFor(roles: AppRole[]): LayoutItem[] {
  const seen = new Set<string>();
  const out: LayoutItem[] = [];
  for (const r of roles) for (const item of CODE_DEFAULTS[r] ?? []) {
    if (!seen.has(item.id)) { seen.add(item.id); out.push(item); }
  }
  return out.slice(0, MAX_WIDGETS);
}

export const SIZE_CLASS: Record<WidgetSize, string> = {
  small: "lg:col-span-1",
  medium: "lg:col-span-2",
  wide: "lg:col-span-4",
};
