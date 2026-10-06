import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { PreferenceControls } from "@/components/mc/preference-controls";
import { PushPrompt } from "@/components/mc/push-prompt";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NOTIFICATION_TYPES } from "@/config/notification-types";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { supabase } from "@/integrations/supabase/client";

type Tab = "preferences" | "notifications";

export const Route = createFileRoute("/_authenticated/_app/settings")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (s["tab"] === "notifications" ? { tab: "notifications" } : {}),
  head: () => ({ meta: [
    { title: "My settings — MediCore HMS" },
    { name: "description", content: "Your language, display and notification settings." },
  ] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("nset.pageTitle")}</h1>
      <Tabs value={tab ?? "preferences"} onValueChange={(v) => void navigate({ search: v === "notifications" ? { tab: "notifications" } : {} })}>
        <TabsList><TabsTrigger value="preferences">{t("nset.tabPrefs")}</TabsTrigger><TabsTrigger value="notifications">{t("nset.tab")}</TabsTrigger></TabsList>
        <TabsContent value="preferences" className="pt-2"><PreferenceControls /></TabsContent>
        <TabsContent value="notifications" className="space-y-4 pt-2"><PushPrompt /><NotificationSettings /></TabsContent>
      </Tabs>
    </div>
  );
}

function NotificationSettings() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("notification_preferences" as never).select("disabled_types").eq("user_id", u.user?.id ?? "").maybeSingle();
      if (error) throw error;
      return ((data as { disabled_types: string[] } | null)?.disabled_types ?? []) as string[];
    },
  });
  const [off, setOff] = useState<string[]>([]);
  useEffect(() => { if (q.data) setOff(q.data); }, [q.data]);
  const save = useEdgeFunction("save-notification-preferences", { invalidate: [["notification-preferences"]], successMessage: t("nset.saved") });
  if (q.isLoading) return <Skeleton className="h-80" />;
  const dirty = JSON.stringify([...off].sort()) !== JSON.stringify([...(q.data ?? [])].sort());
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("nset.desc")}</p>
      <ul className="divide-y rounded-staff border">
        {NOTIFICATION_TYPES.map((n) => (
          <li key={n.id} className="flex items-center justify-between gap-4 p-3">
            <div>
              <p className="text-sm font-medium">{t(`nset.types.${n.id}`)}</p>
              {n.critical && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" aria-hidden />{t("nset.critical")}</p>}
            </div>
            <Switch aria-label={t(`nset.types.${n.id}`)} checked={n.critical || !off.includes(n.id)} disabled={n.critical}
              onCheckedChange={(on) => setOff((x) => on ? x.filter((y) => y !== n.id) : [...x, n.id])} />
          </li>
        ))}
      </ul>
      <div className="flex justify-end"><Button disabled={!dirty || save.isPending} onClick={() => save.mutate({ disabled_types: off })}>{t("nset.save")}</Button></div>
    </div>
  );
}
