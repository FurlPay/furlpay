// Offline read-only data layer.
//
// The service worker (src/sw.ts) deliberately never caches /api/* — instead,
// getJSON (lib/api.ts) writes successful responses for the read-only account
// endpoints below into IndexedDB, and falls back to them when the network is
// gone. Keeping this out of the SW cache means logout can wipe exactly the
// personal data (clearOfflineData) without touching the app shell.
//
// Write actions are never queued or faked offline — sendJSON/postJSON fail
// fast with OFFLINE_WRITE_MESSAGE.

import { useSyncExternalStore } from "react";

const DB_NAME = "furlpay-offline";
const STORE = "api-cache";
const DB_VERSION = 1;

// Fired (on window) whenever cached data is served instead of the network,
// with { savedAt } in detail — the offline banner listens for it.
export const OFFLINE_DATA_EVENT = "furlpay:offline-data";

// Fired whenever a live network response succeeds again — clears the banner
// in the "server unreachable but Wi-Fi connected" case navigator.onLine misses.
export const ONLINE_DATA_EVENT = "furlpay:online-data";

export const OFFLINE_WRITE_MESSAGE =
  "You're offline. Payments, trades and other actions need a connection — nothing was sent.";

// Read-only account endpoints worth serving stale. Auth (/api/auth/*),
// payments, trades and everything else are intentionally absent.
const CACHEABLE_PATHS = [
  "/api/overview",
  "/api/banking",
  "/api/investing/portfolio",
  "/api/transactions",
  "/api/cards",
  "/api/bills",
  "/api/analytics",
  "/api/rewards",
  "/api/earn",
  "/api/credit",
  "/api/profile",
  "/api/escrow",
];

export interface CachedResponse<T> {
  data: T;
  savedAt: number;
}

function isCacheable(url: string): boolean {
  const path = url.split("?")[0];
  return CACHEABLE_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<R>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<R>
): Promise<R> {
  const db = await openDb();
  try {
    return await new Promise<R>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Store a successful response (no-op for non-cacheable URLs). */
export async function writeCached(url: string, data: unknown): Promise<void> {
  if (!idbAvailable() || !isCacheable(url)) return;
  try {
    await withStore("readwrite", (s) =>
      s.put({ data, savedAt: Date.now() } satisfies CachedResponse<unknown>, url)
    );
  } catch {
    // Cache writes are best-effort; never break the live path.
  }
}

/** Read a previously stored response, or null. */
export async function readCached<T>(url: string): Promise<CachedResponse<T> | null> {
  if (!idbAvailable() || !isCacheable(url)) return null;
  try {
    const hit = await withStore<CachedResponse<T> | undefined>("readonly", (s) => s.get(url));
    return hit ?? null;
  } catch {
    return null;
  }
}

/** Wipe all offline account data + cached page HTML. Called on logout. */
export async function clearOfflineData(): Promise<void> {
  try {
    if (idbAvailable()) await withStore("readwrite", (s) => s.clear());
  } catch {
    /* best-effort */
  }
  try {
    // Cached page HTML/RSC may embed the signed-in shell — drop those too.
    if (typeof caches !== "undefined") {
      await caches.delete("furlpay-pages");
      await caches.delete("furlpay-pages-rsc");
    }
  } catch {
    /* best-effort */
  }
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

export function announceOfflineData(savedAt: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OFFLINE_DATA_EVENT, { detail: { savedAt } }));
}

export function announceOnlineData(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ONLINE_DATA_EVENT));
}

// ---- React helper -----------------------------------------------------------

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Live navigator.onLine as React state (true during SSR). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  );
}
