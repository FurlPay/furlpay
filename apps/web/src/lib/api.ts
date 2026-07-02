// Tiny typed fetch helpers for client components — offline-aware.
//
// Reads (getJSON): successful responses for read-only account endpoints are
// mirrored into IndexedDB (lib/offline.ts). If the network is unreachable,
// the cached copy is served and an OFFLINE_DATA_EVENT announces its age so
// the offline banner can say "last updated X min ago". HTTP errors (4xx/5xx)
// are NOT masked by the cache — only genuine network failures fall back.
//
// Writes (sendJSON/postJSON): fail fast when offline. Payments and trades are
// never queued or faked.

import {
  announceOfflineData,
  announceOnlineData,
  isOffline,
  OFFLINE_WRITE_MESSAGE,
  readCached,
  writeCached,
} from "./offline";

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function getJSON<T>(url: string): Promise<T> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new HttpError(res.status, `GET ${url} failed: ${res.status}`);
    const data = (await res.json()) as T;
    void writeCached(url, data);
    announceOnlineData();
    return data;
  } catch (err) {
    // Server answered → real error, don't serve stale data over it.
    if (err instanceof HttpError) throw err;
    const cached = await readCached<T>(url);
    if (cached) {
      announceOfflineData(cached.savedAt);
      return cached.data;
    }
    throw err;
  }
}

export async function sendJSON<T>(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" = "POST"
): Promise<T> {
  if (isOffline()) throw new Error(OFFLINE_WRITE_MESSAGE);
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status}`);
  return res.json();
}

// Like sendJSON but never throws on non-2xx — returns the parsed body alongside
// ok/status so callers can surface server error messages (e.g. OTP failures).
export async function postJSON<T>(
  url: string,
  body: unknown
): Promise<{ ok: boolean; status: number; data: T }> {
  if (isOffline()) {
    return { ok: false, status: 0, data: { error: OFFLINE_WRITE_MESSAGE } as T };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}
