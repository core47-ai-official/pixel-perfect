import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { NOTIFICATION_TYPES } from "@/config/notification-types";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { supabase } from "@/integrations/supabase/client";

/** Per-user on/off switches for notification types; critical types are locked on. Used by staff settings and the patient portal. */
export function NotificationSettings() {
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
