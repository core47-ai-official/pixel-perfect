import { useSyncExternalStore } from "react";

/** Active "act as user" session, kept per browser tab (sessionStorage). */
export interface ImpersonationState {
  sessionId: string;
  expiresAt: string;
  targetName: string;
  targetRole: string;
}

const KEY = "medicore.impersonation";
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: ImpersonationState | null } = { raw: null, value: null };

export function getImpersonation(): ImpersonationState | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(KEY);
  if (raw !== cache.raw) {
    let value: ImpersonationState | null = null;
    try {
      value = raw ? (JSON.parse(raw) as ImpersonationState) : null;
    } catch {
      value = null;
    }
    cache = { raw, value };
  }
  const v = cache.value;
  if (v && new Date(v.expiresAt).getTime() <= Date.now()) return null;
  return v;
}

export function setImpersonation(v: ImpersonationState | null) {
  if (typeof window === "undefined") return;
  if (v) window.sessionStorage.setItem(KEY, JSON.stringify(v));
  else window.sessionStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

export function useImpersonation() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getImpersonation,
    () => null,
  );
}
