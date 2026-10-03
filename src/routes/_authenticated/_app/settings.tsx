import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/mc/placeholder-page";

export const Route = createFileRoute("/_authenticated/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — MediCore HMS" }] }),
  component: () => (
    <PlaceholderPage id="settings" />
  ),
});
