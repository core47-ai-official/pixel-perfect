import { useEffect, useRef } from "react";

const EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "visibilitychange"] as const;
const STORAGE_KEY = "medicore.lastActivity";

/** Calls onIdle after `minutes` without activity. Activity is shared across tabs via localStorage. */
export function useIdleTimeout(minutes: number, onIdle: () => void, enabled = true) {
  const cb = useRef(onIdle);
  cb.current = onIdle;

  useEffect(() => {
    if (!enabled) return;
    const limit = minutes * 60_000;
    let last = Date.now();
    const mark = () => {
      const now = Date.now();
      if (now - last > 5_000) {
        last = now;
        localStorage.setItem(STORAGE_KEY, String(now));
      }
    };
    localStorage.setItem(STORAGE_KEY, String(last));
    EVENTS.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const timer = window.setInterval(() => {
      const shared = Number(localStorage.getItem(STORAGE_KEY) || last);
      if (Date.now() - Math.max(last, shared) >= limit) {
        window.clearInterval(timer);
        cb.current();
      }
    }, 15_000);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, mark));
      window.clearInterval(timer);
    };
  }, [minutes, enabled]);
}
