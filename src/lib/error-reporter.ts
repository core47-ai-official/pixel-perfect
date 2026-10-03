import { callEdgeFunction } from "@/hooks/use-edge-function";

/** Sends uncaught browser errors to log-client-error. Throttled, de-duplicated, never throws. */
const MAX_PER_MINUTE = 5;
let sentAt: number[] = [];
const seen = new Set<string>();
let installed = false;

function report(message: string, stack?: string) {
  const now = Date.now();
  sentAt = sentAt.filter((t) => now - t < 60_000);
  const sig = `${message}|${stack?.slice(0, 200) ?? ""}`;
  if (sentAt.length >= MAX_PER_MINUTE || seen.has(sig)) return;
  sentAt.push(now);
  seen.add(sig);
  void callEdgeFunction("log-client-error", {
    page: window.location.pathname,
    message: message.slice(0, 1000),
    stack: stack?.slice(0, 8000) ?? null,
  }).catch(() => undefined);
}

export function installErrorReporter() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => report(e.message || "Unknown error", e.error?.stack));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { message?: string; stack?: string } | string | undefined;
    // Edge-function failures are already logged on the server.
    if (r && typeof r === "object" && "code" in r) return;
    report(typeof r === "string" ? r : r?.message || "Unhandled promise rejection", typeof r === "object" ? r?.stack : undefined);
  });
}

/** For errors caught by React error boundaries (they don't reach window "error"). */
export function reportClientError(err: unknown) {
  if (typeof window === "undefined") return;
  const e = err as { message?: string; stack?: string };
  report(e?.message || String(err), e?.stack);
}
