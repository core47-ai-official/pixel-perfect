import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyContext, type AppRole } from "@/hooks/use-my-context";

/** Renders children only if the caller has one of `roles`; otherwise sends them to the 403 page. */
export function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { context, isLoading, hasRole } = useMyContext();
  if (isLoading || !context) return <Skeleton className="m-6 h-40" />;
  if (!hasRole(...roles)) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}
