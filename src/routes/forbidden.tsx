import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/forbidden")({
  head: () => ({
    meta: [
      { title: "No access — MediCore HMS" },
      { name: "description", content: "You don't have permission to view this page." },
      { property: "og:title", content: "No access — MediCore HMS" },
      { property: "og:description", content: "You don't have permission to view this page." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Forbidden,
});

function Forbidden() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <ShieldX className="mx-auto h-12 w-12 text-destructive" aria-hidden />
        <p className="mt-4 text-5xl font-bold text-foreground tnum">{t("forbidden.code")}</p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">{t("forbidden.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("forbidden.body")}</p>
        <Button asChild className="mt-6">
          <Link to="/dashboard">{t("forbidden.home")}</Link>
        </Button>
      </div>
    </main>
  );
}
