import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/mc/placeholder-page";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";

export const Route = createFileRoute("/_authenticated/_app/wards")({
  head: () => ({ meta: [{ title: "Wards & beds — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("wards")}>
      <PlaceholderPage id="wards" />
    </RequireRole>
  ),
});
