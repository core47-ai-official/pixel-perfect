import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { withDefaults, isHex, type CompanySettingsResponse } from "@/config/company-settings";

export const COMPANY_SETTINGS_KEY = ["company-settings"] as const;

/** Company settings for the caller's hospital (public fields only for non-admins), merged with defaults. */
export function useCompanySettings() {
  const { context } = useMyContext();
  const q = useQuery({
    queryKey: [...COMPANY_SETTINGS_KEY, context?.hospital?.id ?? null],
    enabled: !!context?.hospital?.id,
    queryFn: () => callEdgeFunction<CompanySettingsResponse>("get-company-settings"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { ...q, values: withDefaults(q.data?.settings), raw: q.data ?? null };
}

/* ---------- branding cache: lets sign-in pages show the last-seen logo/name/colour ---------- */

const BRAND_KEY = "medicore.branding";
export interface CachedBranding { name?: string; logoUrl?: string; accent?: string }

export function readCachedBranding(): CachedBranding {
  try {
    return JSON.parse(localStorage.getItem(BRAND_KEY) ?? "{}") as CachedBranding;
  } catch {
    return {};
  }
}
export function writeCachedBranding(b: CachedBranding) {
  localStorage.setItem(BRAND_KEY, JSON.stringify(b));
}

export function applyAccent(hex: string | undefined) {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  if (hex && isHex(hex)) root.setProperty("--brand", hex);
  else root.removeProperty("--brand");
}

export function applyFavicon(url: string | undefined) {
  if (!url || typeof document === "undefined") return;
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}

/** For pages before sign-in: cached branding, applied after hydration. */
export function useCachedBranding() {
  const [b, setB] = useState<CachedBranding>({});
  useEffect(() => {
    const c = readCachedBranding();
    setB(c);
    applyAccent(c.accent);
  }, []);
  return b;
}
