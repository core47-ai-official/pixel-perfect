import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SessionGate } from "@/components/mc/session-gate";
import { AppShell } from "@/components/mc/app-shell";

export const Route = createFileRoute("/_authenticated/_app")({
  component: () => (
    <SessionGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </SessionGate>
  ),
});
