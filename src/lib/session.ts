import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SignOutReason = "deactivated" | "timeout" | "hospital";

/** Idle timeout in minutes. Will come from company settings later. */
export const IDLE_TIMEOUT_MINUTES = 30;

/** Ordered sign-out: stop queries, drop cache, end session, replace history. */
export async function signOutEverywhere(
  queryClient: QueryClient,
  navigate: (opts: { to: "/auth"; search: { reason?: SignOutReason }; replace: true }) => unknown,
  reason?: SignOutReason,
) {
  await queryClient.cancelQueries();
  queryClient.clear();
  if (typeof window !== "undefined") window.sessionStorage.removeItem("medicore.impersonationId");
  await supabase.auth.signOut();
  navigate({ to: "/auth", search: reason ? { reason } : {}, replace: true });
}

/** Turns "0300 1234567" / "3001234567" / "+92 300…" into +923001234567. Returns null if not a PK mobile. */
export function normalizePkPhone(input: string): string | null {
  let d = input.replace(/[^\d+]/g, "");
  if (d.startsWith("+92")) d = d.slice(3);
  else if (d.startsWith("0092")) d = d.slice(4);
  else if (d.startsWith("92") && d.length === 12) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  return /^3\d{9}$/.test(d) ? `+92${d}` : null;
}
