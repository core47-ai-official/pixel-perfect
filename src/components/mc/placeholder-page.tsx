import { useTranslation } from "react-i18next";
import { Construction } from "lucide-react";
import { EmptyState } from "@/components/mc/empty-state";
import { FOOTER_PAGES, PAGES } from "@/config/navigation";

/** Empty page used for routes that aren't built yet. */
export function PlaceholderPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const page = (PAGES as Record<string, { icon: typeof Construction }>)[id] ?? FOOTER_PAGES.find((p) => p.id === id);
  return (
    <div className="rounded-lg border bg-card">
      <EmptyState icon={page?.icon ?? Construction} title={t("shell.comingSoon")} description={t("shell.comingSoonBody")} />
    </div>
  );
}
