import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/mc/placeholder-page";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";

export const Route = createFileRoute("/_authenticated/_app/my-bills")({
  head: () => ({ meta: [{ title: "My bills — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("myBills")}>
      <PlaceholderPage id="myBills" />
    </RequireRole>
  ),
});
