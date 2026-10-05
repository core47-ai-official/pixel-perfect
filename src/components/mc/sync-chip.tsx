import { useTranslation } from "react-i18next";
import { Clock, RefreshCw, Trash2, Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/mc/ltr";
import { cn } from "@/lib/utils";
import { removeQueued, retryQueued, syncNow, useOfflineQueue } from "@/lib/offline-queue";

/** Top-bar Online / Offline / Syncing (n) chip with the list of queued offline actions. */
export function SyncChip() {
  const { t } = useTranslation();
  const { online, items, syncing, pending } = useOfflineQueue();
  const showSync = online && (syncing || pending > 0);
  const label = !online ? t("shell.offline") : showSync ? t("offline.syncing", { n: pending }) : t("shell.online");
  const Icon = !online ? WifiOff : showSync ? RefreshCw : Wifi;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
            !online ? "border-inactive/40 text-inactive" : showSync ? "border-warning/40 text-warning" : "border-ok/40 text-ok",
          )}
        >
          <Icon className={cn("size-3.5", showSync && syncing && "animate-spin")} aria-hidden />
          <span className={cn(!showSync && online && "hidden sm:inline")}>{label}</span>
          {!online && items.length > 0 && <span>({items.length})</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b p-3">
          <p className="text-sm font-medium">{t("offline.queueTitle")}</p>
          {online && items.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => void syncNow()} disabled={syncing}><RefreshCw /> {t("offline.syncNow")}</Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{online ? t("offline.allSynced") : t("offline.emptyOffline")}</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-auto">
            {items.map((i) => (
              <li key={i.id} className="flex items-start gap-2 p-3 text-sm">
                {i.status === "failed"
                  ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  : <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label={t("offline.waiting")} />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t(`offline.kind.${i.kind}`)} · {i.label}</p>
                  <p className="text-xs text-muted-foreground"><Ltr>{i.temp_no}</Ltr> · {new Date(i.created_at).toLocaleTimeString()}</p>
                  {i.error && <p className="text-xs text-destructive">{i.error}</p>}
                </div>
                {i.status === "failed" && (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="size-7" title={t("offline.retry")} onClick={() => void retryQueued(i)}><RefreshCw /></Button>
                    <Button size="icon" variant="ghost" className="size-7" title={t("offline.discard")} onClick={() => void removeQueued(i.id)}><Trash2 /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
