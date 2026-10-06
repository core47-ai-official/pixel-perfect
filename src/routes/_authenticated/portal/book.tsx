import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PCard } from "@/components/mc/portal-shell";
import { useMyPatient } from "@/lib/portal";

export const Route = createFileRoute("/_authenticated/portal/book")({
  head: () => ({ meta: [{ title: "Book a visit — Patient portal" }, { name: "description", content: "Book an appointment with a hospital doctor." }] }),
  component: Book,
});

function Book() {
  const { t } = useTranslation();
  const me = useMyPatient();
  if (!me.isLoading && !me.data) return <NotLinked />;
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t("portal.nav.book")}</h1>
      <PCard><p className="text-muted-foreground">{t("portal.bookSoon")}</p></PCard>
    </div>
  );
}

/** Shown on portal tabs until the account is linked to a hospital record. */
export function NotLinked() {
  const { t } = useTranslation();
  return (
    <PCard className="space-y-3">
      <p>{t("portal.notLinked")}</p>
      <Button asChild className="rounded-patient"><Link to="/portal">{t("portal.link.title")}</Link></Button>
    </PCard>
  );
}
