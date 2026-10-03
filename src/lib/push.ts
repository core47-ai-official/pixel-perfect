import { callEdgeFunction } from "@/hooks/use-edge-function";

/** Public VAPID key (safe to ship). The private key lives only in Supabase function secrets. */
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushState = "unsupported" | "ios-needs-install" | "default" | "granted" | "denied";

function inIframe() {
  try { return window.self !== window.top; } catch { return true; }
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function getPushState(): PushState {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "ios-needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return Notification.permission as PushState;
}

function urlBase64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Registers the worker (skipped inside the editor preview frame). */
export async function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || inIframe()) return null;
  return navigator.serviceWorker.register("/sw.js");
}

/** Asks permission, subscribes, and sends the subscription to register-push-subscription. */
export async function enablePush(): Promise<PushState> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm as PushState;
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  if (!reg || !VAPID_PUBLIC_KEY) throw new Error("push-not-configured");
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));
  const json = sub.toJSON();
  await callEdgeFunction("register-push-subscription", {
    endpoint: json.endpoint,
    keys: json.keys,
    device: navigator.userAgent.slice(0, 200),
  });
  return "granted";
}
