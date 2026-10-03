import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/mc/placeholder-page";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";

export const Route = createFileRoute("/_authenticated/_app/consultations")({
  head: () => ({ meta: [{ title: "Consultations — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("consultations")}>
      <PlaceholderPage id="consultations" />
    </RequireRole>
  ),
});
