import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Ltr } from "./ltr";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { setImpersonation, useImpersonation } from "@/lib/impersonation";

/** Red full-width "Acting as …" bar with countdown; logs each page visited during the session. */
export function ImpersonationBanner() {
  const { t } = useTranslation();
  const imp = useImpersonation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const lastLogged = useRef<string | null>(null);

  const leave = async (callServer: boolean, message: string) => {
    const id = imp?.sessionId;
    setImpersonation(null);
    if (callServer && id) {
      setBusy(true);
      await callEdgeFunction("end-impersonation", { session_id: id }).catch(() => undefined);
      setBusy(false);
    }
    await qc.invalidateQueries();
    toast(message);
    navigate({ to: "/users" });
  };

  useEffect(() => {
    if (!imp) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [imp]);

  const remaining = imp ? new Date(imp.expiresAt).getTime() - now : 0;
  useEffect(() => {
    if (imp && remaining <= 0) void leave(true, t("impersonation.expired"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imp, remaining <= 0]);

  useEffect(() => {
    if (!imp || lastLogged.current === `${imp.sessionId}:${pathname}`) return;
    lastLogged.current = `${imp.sessionId}:${pathname}`;
    void callEdgeFunction("log-impersonation-page", { session_id: imp.sessionId, path: pathname }).catch(() => undefined);
  }, [imp, pathname]);

  if (!imp) return null;
  const secs = Math.max(0, Math.floor(remaining / 1000));
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div role="alert" className="sticky top-0 z-30 flex flex-wrap items-center justify-center gap-3 bg-urgent px-4 py-2 text-sm font-medium text-urgent-foreground">
      <UserX className="h-4 w-4" aria-hidden />
      <span>{t("impersonation.actingAs", { name: imp.targetName, role: t(`roles.${imp.targetRole}`) })}</span>
      <span className="opacity-90">
        {t("impersonation.timeLeft")} <Ltr>{clock}</Ltr>
      </span>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => leave(true, t("impersonation.ended"))}>
        {t("impersonation.exit")}
      </Button>
    </div>
  );
}
