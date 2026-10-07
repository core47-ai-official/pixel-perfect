import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { SessionGate } from "@/components/mc/session-gate";
import { AppShell } from "@/components/mc/app-shell";
import { useMyContext } from "@/hooks/use-my-context";

export const Route = createFileRoute("/_authenticated/_app")({
  component: () => (
    <SessionGate>
      <PatientsToPortal>
        <AppShell>
          <Outlet />
        </AppShell>
      </PatientsToPortal>
    </SessionGate>
  ),
});

/** Accounts whose only role is patient use the patient portal, not the staff app. */
function PatientsToPortal({ children }: { children: ReactNode }) {
  const { context } = useMyContext();
  const navigate = useNavigate();
  const patientOnly = !!context && context.roles.length > 0 && context.roles.every((r) => r === "patient") && !context.impersonation;
  useEffect(() => { if (patientOnly) void navigate({ to: "/portal", replace: true }); }, [patientOnly, navigate]);
  const outsideOnly = !!context && context.roles.length > 0 && context.roles.every((r) => r === "outside_doctor") && !context.impersonation;
  const here = typeof window !== "undefined" ? window.location.pathname : "";
  useEffect(() => { if (outsideOnly && !here.startsWith("/tracker-connections") && !here.startsWith("/settings")) void navigate({ to: "/tracker-connections", replace: true }); }, [outsideOnly, here, navigate]);
  return patientOnly ? null : <>{children}</>;
}
