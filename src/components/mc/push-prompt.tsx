import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Banner } from "@/components/mc/banner";
import { Button } from "@/components/ui/button";
import { enablePush, getPushState, registerServiceWorker, type PushState } from "@/lib/push";

const KEY = "medicore.pushPrompt";

/** Shown after first sign-in: asks for push permission, or explains a block / the iPhone install step. */
export function PushPrompt() {
  const { t } = useTranslation();
  const [state, setState] = useState<PushState>("unsupported");
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setState(getPushState());
    setDismissed(localStorage.getItem(KEY) === "dismissed");
    void registerServiceWorker().catch(() => {});
  }, []);

  const dismiss = () => {
    localStorage.setItem(KEY, "dismissed");
    setDismissed(true);
  };

  if (state === "granted" || state === "unsupported") return null;

  if (state === "denied") {
    return (
      <Banner tone="warning" title={t("notifications.blockedTitle")}>
        {t("notifications.blockedBody")}
      </Banner>
    );
  }

  if (dismissed) return null;

  if (state === "ios-needs-install") {
    return (
      <Banner tone="info" title={t("notifications.enableTitle")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{t("notifications.iosTip")}</span>
          <Button size="sm" variant="ghost" onClick={dismiss}>{t("notifications.dismiss")}</Button>
        </div>
      </Banner>
    );
  }

  return (
    <Banner tone="info" title={t("notifications.enableTitle")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{t("notifications.enableBody")}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={dismiss}>{t("notifications.later")}</Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const s = await enablePush();
                setState(s);
                if (s === "granted") toast.success(t("notifications.enabled"));
              } catch {
                toast.error(t("notifications.failed"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("notifications.enable")}
          </Button>
        </div>
      </div>
    </Banner>
  );
}
