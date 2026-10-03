import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/mc/placeholder-page";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";

export const Route = createFileRoute("/_authenticated/_app/my-records")({
  head: () => ({ meta: [{ title: "My records — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("myRecords")}>
      <PlaceholderPage id="myRecords" />
    </RequireRole>
  ),
});
