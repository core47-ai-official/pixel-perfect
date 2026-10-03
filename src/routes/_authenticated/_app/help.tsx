import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/mc/placeholder-page";

export const Route = createFileRoute("/_authenticated/_app/help")({
  head: () => ({ meta: [{ title: "Help — MediCore HMS" }] }),
  component: () => (
    <PlaceholderPage id="help" />
  ),
});
