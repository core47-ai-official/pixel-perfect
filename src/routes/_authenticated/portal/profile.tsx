import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { useMyContext } from "@/hooks/use-my-context";
import { signOutEverywhere } from "@/lib/session";
import { useMyPatient } from "@/lib/portal";

export const Route = createFileRoute("/_authenticated/portal/profile")({
  head: () => ({ meta: [{ title: "My profile — Patient portal" }, { name: "description", content: "Your account and hospital record details." }] }),
  component: Profile,
});

function Profile() {
  const { t } = useTranslation();
  const { context } = useMyContext();
  const me = useMyPatient();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const login = context?.profile?.email ?? context?.profile?.phone ?? "";
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t("portal.nav.profile")}</h1>
      <PCard className="space-y-1">
        <p className="text-lg font-semibold">{me.data?.full_name ?? context?.profile?.full_name}</p>
        {me.data && <p className="text-sm">MRN <Ltr>{me.data.mrn}</Ltr></p>}
        <p className="text-sm text-muted-foreground">{t("portal.login")}: <Ltr>{login}</Ltr></p>
        {!me.data && <p className="text-sm text-muted-foreground">{t("portal.notLinked")}</p>}
      </PCard>
      <Button variant="outline" size="lg" className="w-full rounded-patient" onClick={() => void signOutEverywhere(qc, navigate)}>
        <LogOut aria-hidden />{t("auth.signOut")}
      </Button>
    </div>
  );
}
