import { useEffect, useState } from "react";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";

/** Only these three actions may be queued while offline; sync-offline-queue mirrors this list. */
export type OfflineKind = "register-patient" | "record-payment" | "record-deposit";
export interface QueueItem {
  id: string; // client-generated; the server skips ids it already processed
  kind: OfflineKind;
  body: Record<string, unknown>;
  label: string; // shown in the queue list
  temp_no: string; // provisional number printed while offline
  created_at: string;
  status: "pending" | "failed";
  error?: string;
}
export interface SyncResult { id: string; status: "done" | "failed"; data?: unknown; error?: EdgeError }

const DB = "mc-offline";
const STORE = "queue";
const bus = new EventTarget();
let syncing = false;

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
const changed = () => bus.dispatchEvent(new Event("change"));

export const listQueue = async () =>
  typeof indexedDB === "undefined" ? [] : ((await tx<QueueItem[]>("readonly", (s) => s.getAll())) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
export async function removeQueued(id: string) { await tx("readwrite", (s) => s.delete(id)); changed(); }
async function put(item: QueueItem) { await tx("readwrite", (s) => s.put(item)); changed(); }

export const isOffline = () => typeof navigator !== "undefined" && !navigator.onLine;
export const isNetworkError = (e: unknown) => isOffline() || (e as EdgeError)?.code === "network";

export async function enqueue(kind: OfflineKind, body: Record<string, unknown>, label: string) {
  const id = crypto.randomUUID();
  const temp_no = `TMP-${id.slice(0, 8).toUpperCase()}`;
  const item: QueueItem = { id, kind, body, label, temp_no, created_at: new Date().toISOString(), status: "pending" };
  await put(item);
  return item;
}

/**
 * Calls the function online; when offline (or the network drops) saves it to the queue instead.
 * Returns { queued: item } or { data }.
 */
export async function callOrQueue<T>(kind: OfflineKind, body: Record<string, unknown>, label: string):
  Promise<{ queued: QueueItem; data?: undefined } | { queued?: undefined; data: T }> {
  if (!isOffline()) {
    try { return { data: await callEdgeFunction<T>(kind, body) }; } catch (e) { if (!isNetworkError(e)) throw e; }
  }
  return { queued: await enqueue(kind, body, label) };
}

/** Sends everything pending in one batch. Successful items leave the queue; failures stay with their message. */
export async function syncNow() {
  if (syncing || isOffline()) return;
  const items = await listQueue();
  if (!items.length) return;
  syncing = true; changed();
  try {
    const res = await callEdgeFunction<{ results: SyncResult[] }>("sync-offline-queue", {
      items: items.slice(0, 50).map(({ id, kind, body }) => ({ id, kind, body })),
    });
    for (const r of res.results) {
      const item = items.find((i) => i.id === r.id);
      if (!item) continue;
      if (r.status === "done") await removeQueued(r.id);
      else await put({ ...item, status: "failed", error: r.error?.message ?? "Failed" });
    }
    bus.dispatchEvent(new CustomEvent("synced", { detail: res.results }));
  } catch { /* still offline or server unreachable — try again later */ } finally { syncing = false; changed(); }
}

export function retryQueued(item: QueueItem) { return put({ ...item, status: "pending", error: undefined }).then(syncNow); }

export function onSynced(cb: (r: SyncResult[]) => void) {
  const h = (e: Event) => cb((e as CustomEvent<SyncResult[]>).detail);
  bus.addEventListener("synced", h);
  return () => bus.removeEventListener("synced", h);
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    on();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);
  return online;
}

/** Queue contents + sync state; also drives auto-sync (on reconnect and every 30s). */
export function useOfflineQueue() {
  const online = useOnline();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = () => { void listQueue().then(setItems).catch(() => {}); setBusy(syncing); };
    load();
    bus.addEventListener("change", load);
    return () => bus.removeEventListener("change", load);
  }, []);
  useEffect(() => {
    if (!online) return;
    void syncNow();
    const t = setInterval(() => void syncNow(), 30_000);
    return () => clearInterval(t);
  }, [online]);
  return { online, items, syncing: busy, pending: items.filter((i) => i.status === "pending").length };
}
