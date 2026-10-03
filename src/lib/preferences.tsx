import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import i18n from "@/i18n";

export type Language = "en" | "ur";
export type Theme = "light" | "dark";
export type Density = "comfortable" | "compact";

type Prefs = { language: Language; theme: Theme; density: Density };
type Ctx = Prefs & {
  dir: "ltr" | "rtl";
  setLanguage: (l: Language) => void;
  setTheme: (t: Theme) => void;
  setDensity: (d: Density) => void;
};

const KEY = "medicore.prefs";
const DEFAULTS: Prefs = { language: "en", theme: "light", density: "comfortable" };
const PreferencesContext = createContext<Ctx | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  // Load saved prefs after hydration (server always renders defaults).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
      setPrefs((p) => ({ ...p, ...saved }));
    } catch {
      /* ignore bad storage */
    }
  }, []);

  // Apply prefs to <html> and i18n, then persist.
  useEffect(() => {
    const html = document.documentElement;
    html.lang = prefs.language;
    html.dir = prefs.language === "ur" ? "rtl" : "ltr";
    html.classList.toggle("dark", prefs.theme === "dark");
    html.dataset["density"] = prefs.density;
    if (i18n.language !== prefs.language) void i18n.changeLanguage(prefs.language);
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }, [prefs]);

  const setLanguage = useCallback((language: Language) => setPrefs((p) => ({ ...p, language })), []);
  const setTheme = useCallback((theme: Theme) => setPrefs((p) => ({ ...p, theme })), []);
  const setDensity = useCallback((density: Density) => setPrefs((p) => ({ ...p, density })), []);

  return (
    <PreferencesContext.Provider
      value={{ ...prefs, dir: prefs.language === "ur" ? "rtl" : "ltr", setLanguage, setTheme, setDensity }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside PreferencesProvider");
  return ctx;
}
