import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Moon, Sun } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarSeparator,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { HospitalLogo } from "@/components/mc/hospital-logo";
import { FOOTER_PAGES, GROUP_ORDER, pagesForRoles, type NavPage } from "@/config/navigation";
import { useMyContext } from "@/hooks/use-my-context";
import { usePreferences } from "@/lib/preferences";

function NavItem({ page, active }: { page: NavPage; active: boolean }) {
  const { t } = useTranslation();
  const label = t(`nav.${page.id}`);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link to={page.path}>
          <page.icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const { t } = useTranslation();
  const { dir, theme, setTheme } = usePreferences();
  const { context } = useMyContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pages = pagesForRoles(context?.roles ?? []);
  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");
  const name = context?.profile?.full_name ?? "";
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <Sidebar collapsible="icon" side={dir === "rtl" ? "right" : "left"}>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1.5">
          <HospitalLogo className="size-8 shrink-0" />
          <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">{context?.hospital?.name}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {GROUP_ORDER.map((g) => {
          const items = pages.filter((p) => p.group === g);
          if (!items.length) return null;
          return (
            <SidebarGroup key={g}>
              <SidebarGroupLabel>{t(`navGroup.${g}`)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((p) => <NavItem key={p.id} page={p} active={isActive(p.path)} />)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {FOOTER_PAGES.map((p) => <NavItem key={p.id} page={p} active={isActive(p.path)} />)}
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={theme === "dark" ? t("prefs.light") : t("prefs.dark")}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
              <span>{theme === "dark" ? t("prefs.light") : t("prefs.dark")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSeparator />
        <div className="flex items-center gap-2 px-1 py-1">
          <Avatar className="size-8 shrink-0">
            {context?.profile?.photo_url && <AvatarImage src={context.profile.photo_url} alt={name} />}
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {(context?.roles ?? []).map((r) => t(`roles.${r}`)).join(", ")}
            </p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
