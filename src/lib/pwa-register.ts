/** The only place the offline app worker (/sw.js) is registered. Refuses in dev, preview and iframes. */
function inIframe() {
  try { return window.self !== window.top; } catch { return true; }
}

export function pwaAllowed() {
  if (typeof window === "undefined") return false;
  if (!import.meta.env.PROD || inIframe()) return false;
  const h = window.location.hostname;
  const bad = (d: string) => h === d || h.endsWith(`.${d}`);
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return false;
  if (bad("lovableproject.com") || bad("lovableproject-dev.com") || bad("beta.lovable.dev")) return false;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return false;
  return true;
}

async function unregisterAppWorker() {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.filter((r) => (r.active ?? r.installing ?? r.waiting)?.scriptURL.endsWith("/sw.js")).map((r) => r.unregister()));
}

export async function setupPwa() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (!pwaAllowed()) { await unregisterAppWorker().catch(() => {}); return; }
  const { registerSW } = await import("virtual:pwa-register");
  registerSW({ immediate: true });
}
