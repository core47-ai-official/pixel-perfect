import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Banknote, CalendarPlus, CalendarDays, FileText, Home, User } from "lucide-react";
import type { ReactNode } from "react";
import { usePreferences } from "@/lib/preferences";
import { HospitalLogo } from "@/components/mc/hospital-logo";
import { useCachedBranding } from "@/hooks/use-company-settings";

const TABS = [
  { to: "/portal", icon: Home, key: "home", exact: true },
  { to: "/portal/book", icon: CalendarPlus, key: "book" },
  { to: "/portal/appointments", icon: CalendarDays, key: "appointments" },
  { to: "/portal/reports", icon: FileText, key: "reports" },
  { to: "/portal/bills", icon: Banknote, key: "bills" },
  { to: "/portal/profile", icon: User, key: "profile" },
] as const;

/** Softer patient-facing frame: warm background, rounded cards, top language switch, bottom navigation. */
export function PortalShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { language, setLanguage } = usePreferences();
  const brand = useCachedBranding();
  return (
    <div className="portal min-h-screen pb-24">
      <header className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          <HospitalLogo src={brand.logoUrl ?? null} />
          <span className="truncate text-sm font-medium text-muted-foreground">{brand.name}</span>
        </div>
        <div role="group" aria-label={t("portal.language")} className="flex rounded-full border bg-card p-0.5 text-sm">
          {(["en", "ur"] as const).map((l) => (
            <button key={l} type="button" aria-pressed={language === l} onClick={() => setLanguage(l)}
              className={`rounded-full px-3 py-1 ${language === l ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              {l === "en" ? "English" : "اردو"}
            </button>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-4">{children}</main>
      <nav aria-label={t("portal.navLabel")} className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur">
        <ul className="mx-auto grid max-w-xl grid-cols-6">
          {TABS.map(({ to, icon: Icon, key, ...o }) => (
            <li key={key}>
              <Link to={to} activeOptions={{ exact: "exact" in o }}
                className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground data-[status=active]:font-semibold data-[status=active]:text-primary">
                <Icon className="size-5" aria-hidden />{t(`portal.nav.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** Rounded patient-style card. */
export function PCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-patient border bg-card p-4 shadow-sm ${className}`}>{children}</section>;
}
