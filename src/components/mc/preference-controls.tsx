import { Moon, Sun, Rows3, Rows4, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/lib/preferences";

export function PreferenceControls() {
  const { t } = useTranslation();
  const { language, setLanguage, theme, setTheme, density, setDensity } = usePreferences();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => setLanguage(language === "en" ? "ur" : "en")} aria-label={t("prefs.language")}>
        <Languages />
        <span className={language === "en" ? "font-urdu" : "font-sans"}>{language === "en" ? "اردو" : "English"}</span>
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={t("prefs.theme")}>
        {theme === "dark" ? <Sun /> : <Moon />}
        {theme === "dark" ? t("prefs.light") : t("prefs.dark")}
      </Button>
      <Button variant="secondary" size="sm" title={t("prefs.compactHint")} className="hidden lg:inline-flex"
        onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}>
        {density === "compact" ? <Rows3 /> : <Rows4 />}
        {density === "compact" ? t("prefs.comfortable") : t("prefs.compact")}
      </Button>
    </div>
  );
}
