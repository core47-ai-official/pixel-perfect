import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PlaceholderPage } from "@/components/mc/placeholder-page";
import { useMyContext } from "@/hooks/use-my-context";

export const Route = createFileRoute("/_authenticated/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — MediCore HMS" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const { context } = useMyContext();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">{t("auth.welcome", { name: context?.profile?.full_name ?? "" })}</h2>
      <PlaceholderPage id="dashboard" />
    </div>
  );
}
