import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Bug, Languages, LogOut, MoreHorizontal, Plus, Search, WifiOff, Wifi } from "lucide-react";
import { toast } from "sonner";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AppSidebar } from "@/components/mc/app-sidebar";
import { ReportProblemPanel } from "@/components/mc/report-problem";
import { ImpersonationBanner } from "@/components/mc/impersonation-banner";
import { SidePanel } from "@/components/mc/side-panel";
import { NotificationBell } from "@/components/mc/notification-bell";
import { DoctorStatusSwitcher } from "@/components/mc/doctor-status-switcher";
import { PushPrompt } from "@/components/mc/push-prompt";
import { FOOTER_PAGES, findPage, pagesForRoles, quickActionsForRoles, type QuickAction } from "@/config/navigation";
import { useMyContext } from "@/hooks/use-my-context";
import { usePreferences } from "@/lib/preferences";
import { signOutEverywhere } from "@/lib/session";
import { cn } from "@/lib/utils";

function useMinWidth(px: number) {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${px}px)`);
    const on = () => setOk(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [px]);
  return ok;
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    on();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  return online;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { language, setLanguage } = usePreferences();
  const { context } = useMyContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const wide = useMinWidth(1280);
  const [open, setOpen] = useState(true);
  useEffect(() => setOpen(wide), [wide]);
  const online = useOnline();
  const [panel, setPanel] = useState<QuickAction | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const roles = context?.roles ?? [];
  const pages = pagesForRoles(roles);
  const quick = quickActionsForRoles(roles);
  const page = findPage(pathname);
  const title = page ? t(`nav.${page.id}`) : t("app.name");
  const bottom = pages.slice(0, 4);
  const more = [...pages.slice(4), ...FOOTER_PAGES];
  const soon = () => toast(t("shell.placeholder"));

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <div className="flex min-h-screen w-full">
        <div className="hidden md:contents">
          <AppSidebar />
        </div>
        <SidebarInset className="min-w-0">
          <ImpersonationBanner />
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:px-4">
            <SidebarTrigger className="hidden md:inline-flex" aria-label={t("shell.toggleSidebar")} />
            <h1 className="truncate text-base font-semibold md:text-lg">{title}</h1>

            <div className="ms-2 hidden items-center gap-1.5 lg:flex">
              {quick.map((q) => (
                <Button key={q.id} size="sm" variant="secondary" onClick={() => setPanel(q)}>
                  <q.icon />
                  {t(`quick.${q.id}`)}
                </Button>
              ))}
            </div>
            {quick.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="secondary" className="hidden md:inline-flex lg:hidden" aria-label={t("shell.quickAdd")}>
                    <Plus />
                    {t("shell.quickAdd")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {quick.map((q) => (
                    <DropdownMenuItem key={q.id} onSelect={() => setPanel(q)}>
                      <q.icon />
                      {t(`quick.${q.id}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <div className="ms-auto flex items-center gap-1.5">
              <div className="relative hidden w-72 xl:block">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input className="h-9 ps-8" placeholder={t("shell.search")} aria-label={t("shell.search")} onFocus={soon} readOnly />
              </div>
              <Button size="icon" variant="ghost" className="xl:hidden" aria-label={t("shell.search")} onClick={soon}>
                <Search />
              </Button>
              <span
                className={cn(
                  "hidden items-center gap-1 rounded-full border px-2 py-0.5 text-xs sm:inline-flex",
                  online ? "border-ok/40 text-ok" : "border-inactive/40 text-inactive",
                )}
              >
                {online ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
                {online ? t("shell.online") : t("shell.offline")}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setLanguage(language === "en" ? "ur" : "en")} aria-label={t("prefs.language")}>
                <Languages />
                <span className={cn("hidden sm:inline", language === "en" ? "font-urdu" : "font-sans")}>
                  {language === "en" ? "اردو" : "English"}
                </span>
              </Button>
              <DoctorStatusSwitcher />
              <NotificationBell />
              <Button size="icon" variant="ghost" aria-label={t("shell.report")} title={t("shell.report")} onClick={() => setReportOpen(true)}>
                <Bug />
              </Button>
              <Button size="icon" variant="ghost" aria-label={t("auth.signOut")} title={t("auth.signOut")} onClick={() => signOutEverywhere(qc, navigate)}>
                <LogOut />
              </Button>
            </div>
          </header>

          <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6">
            <div className="mb-4 empty:hidden"><PushPrompt /></div>
            {children}
          </main>
        </SidebarInset>
      </div>

      {quick.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              className="fixed bottom-20 end-4 z-30 size-14 rounded-full shadow-lg md:hidden"
              aria-label={t("shell.quickAdd")}
            >
              <Plus className="size-6" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            {quick.map((q) => (
              <DropdownMenuItem key={q.id} onSelect={() => setPanel(q)}>
                <q.icon />
                {t(`quick.${q.id}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background md:hidden" aria-label={t("shell.menu")}>
        {bottom.map((p) => {
          const active = pathname === p.path || pathname.startsWith(p.path + "/");
          return (
            <Link
              key={p.id}
              to={p.path}
              className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-primary" : "text-muted-foreground")}
            >
              <p.icon className="size-5" aria-hidden />
              <span className="max-w-full truncate px-1">{t(`nav.${p.id}`)}</span>
            </Link>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground">
            <MoreHorizontal className="size-5" aria-hidden />
            <span>{t("shell.more")}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="max-h-[60vh] overflow-y-auto">
            {more.map((p) => (
              <DropdownMenuItem key={p.id} asChild>
                <Link to={p.path}>
                  <p.icon />
                  {t(`nav.${p.id}`)}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      <SidePanel
        open={!!panel}
        onOpenChange={(o) => !o && setPanel(null)}
        title={panel ? t(`quick.${panel.id}`) : ""}
        footer={<Button variant="secondary" onClick={() => setPanel(null)}>{t("shell.close")}</Button>}
      >
        <p className="text-sm text-muted-foreground">{t("shell.panelBody")}</p>
      </SidePanel>
    <ReportProblemPanel open={reportOpen} onOpenChange={setReportOpen} />
    </SidebarProvider>
  );
}
