import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Ltr } from "@/components/mc/ltr";
import { supabase } from "@/integrations/supabase/client";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { cn } from "@/lib/utils";

const QK = ["notifications", "mine"];

export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data = [] } = useQuery({
    queryKey: QK,
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id,title,body,link,read_at,created_at,type")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () =>
        qc.invalidateQueries({ queryKey: QK }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);

  const markRead = useEdgeFunction<unknown, { ids?: string[]; all?: boolean }>("mark-notifications-read", { invalidate: [QK] });
  const unread = data.filter((n) => !n.read_at).length;
  const fmt = new Intl.DateTimeFormat(i18n.language === "ur" ? "ur-PK" : "en-PK", { dateStyle: "medium", timeStyle: "short" });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={t("shell.bell")} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -end-0.5 flex min-w-4 h-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground tnum">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div>
            <p className="text-sm font-semibold">{t("notifications.title")}</p>
            {unread > 0 && <p className="text-xs text-muted-foreground">{t("notifications.unread", { count: unread })}</p>}
          </div>
          {unread > 0 && (
            <Button size="sm" variant="ghost" disabled={markRead.isPending} onClick={() => markRead.mutate({ all: true })}>
              {t("notifications.markAll")}
            </Button>
          )}
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {data.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">{t("notifications.empty")}</li>}
          {data.map((n) => (
            <li key={n.id}>
              <button
                className={cn("w-full border-b px-3 py-2 text-start hover:bg-muted", !n.read_at && "bg-accent/40")}
                onClick={() => {
                  if (!n.read_at) markRead.mutate({ ids: [n.id] });
                  if (n.link) void navigate({ to: n.link });
                }}
              >
                <div className="flex items-start gap-2">
                  {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{n.title}</p>
                    {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-muted-foreground"><Ltr>{fmt.format(new Date(n.created_at))}</Ltr></p>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
