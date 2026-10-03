import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SessionGate } from "@/components/mc/session-gate";

export const Route = createFileRoute("/_authenticated/_app")({
  component: () => (
    <SessionGate>
      <Outlet />
    </SessionGate>
  ),
});
