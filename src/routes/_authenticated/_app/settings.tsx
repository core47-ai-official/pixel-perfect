import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PreferenceControls } from "@/components/mc/preference-controls";
import { PushPrompt } from "@/components/mc/push-prompt";
import { NotificationSettings } from "@/components/mc/notification-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Tab = "preferences" | "notifications";

export const Route = createFileRoute("/_authenticated/_app/settings")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (s["tab"] === "notifications" ? { tab: "notifications" } : {}),
  head: () => ({ meta: [
    { title: "My settings — MediCore HMS" },
    { name: "description", content: "Your language, display and notification settings." },
  ] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("nset.pageTitle")}</h1>
      <Tabs value={tab ?? "preferences"} onValueChange={(v) => void navigate({ search: v === "notifications" ? { tab: "notifications" } : {} })}>
        <TabsList><TabsTrigger value="preferences">{t("nset.tabPrefs")}</TabsTrigger><TabsTrigger value="notifications">{t("nset.tab")}</TabsTrigger></TabsList>
        <TabsContent value="preferences" className="pt-2"><PreferenceControls /></TabsContent>
        <TabsContent value="notifications" className="space-y-4 pt-2"><PushPrompt /><NotificationSettings /></TabsContent>
      </Tabs>
    </div>
  );
}
