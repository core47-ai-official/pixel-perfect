import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { HospitalLogo } from "@/components/mc/hospital-logo";
import { PreferenceControls } from "@/components/mc/preference-controls";
import { useMyContext } from "@/hooks/use-my-context";
import { signOutEverywhere } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/_app/dashboard")({
  head: () => ({ meta: [{ title: "Home — MediCore HMS" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { context } = useMyContext();
  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <HospitalLogo className="h-9 w-9" />
          <span className="font-semibold text-foreground">{context?.hospital?.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <PreferenceControls />
          <Button variant="ghost" onClick={() => signOutEverywhere(qc, navigate)}>{t("auth.signOut")}</Button>
        </div>
      </header>
      <section className="p-6">
        <h1 className="text-2xl font-semibold text-foreground">
          {t("auth.welcome", { name: context?.profile?.full_name ?? "" })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("auth.rolesLabel")}: {context?.roles.join(", ")}
        </p>
      </section>
    </main>
  );
}
