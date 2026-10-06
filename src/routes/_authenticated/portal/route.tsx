import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SessionGate } from "@/components/mc/session-gate";
import { PortalShell } from "@/components/mc/portal-shell";
import { useMyContext } from "@/hooks/use-my-context";

export const Route = createFileRoute("/_authenticated/portal")({
  component: () => (
    <SessionGate>
      <PatientOnly><PortalShell><Outlet /></PortalShell></PatientOnly>
    </SessionGate>
  ),
});

/** Staff accounts never see the portal; they go back to their dashboard. */
function PatientOnly({ children }: { children: React.ReactNode }) {
  const { context } = useMyContext();
  const navigate = useNavigate();
  const isPatient = !!context?.roles.includes("patient");
  useEffect(() => { if (context && !isPatient) void navigate({ to: "/dashboard", replace: true }); }, [context, isPatient, navigate]);
  return isPatient ? <>{children}</> : null;
}
