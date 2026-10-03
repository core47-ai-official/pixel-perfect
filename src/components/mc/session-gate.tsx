import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/mc/banner";
import { useMyContext } from "@/hooks/use-my-context";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";
import { IDLE_TIMEOUT_MINUTES, signOutEverywhere } from "@/lib/session";

/**
 * Wraps every signed-in screen: loads get-my-context, signs out deactivated users,
 * forces the change-password page, and enforces the idle timeout.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { context, isLoading, error, refetch } = useMyContext();

  useIdleTimeout(IDLE_TIMEOUT_MINUTES, () => void signOutEverywhere(qc, navigate, "timeout"));

  const deactivated =
    context?.profile?.is_active === false ||
    (error as { code?: string } | null)?.code === "deactivated";
  const hospitalOff = context?.hospital?.is_active === false;
  const mustChange = !!context?.profile?.must_change_password && !context?.impersonation;

  useEffect(() => {
    if (deactivated) void signOutEverywhere(qc, navigate, "deactivated");
    else if (hospitalOff) void signOutEverywhere(qc, navigate, "hospital");
    else if (mustChange && pathname !== "/change-password") navigate({ to: "/change-password", replace: true });
  }, [deactivated, hospitalOff, mustChange, pathname, navigate, qc]);

  if (isLoading || deactivated || hospitalOff || (mustChange && pathname !== "/change-password")) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span>{t("auth.loadingContext")}</span>
      </div>
    );
  }

  if (error || !context) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <Banner variant="danger">
          {t("auth.contextError")} {(error as { message?: string } | null)?.message}
        </Banner>
        <div className="flex gap-2">
          <Button onClick={() => refetch()}>{t("auth.retry")}</Button>
          <Button variant="secondary" onClick={() => signOutEverywhere(qc, navigate)}>
            {t("auth.signOut")}
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
