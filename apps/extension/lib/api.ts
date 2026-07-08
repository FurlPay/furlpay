import type { BgResponse } from "./types";

// ---------------------------------------------------------------------------
// API client for the FurlPay backend. Authentication is the furlpay.com
// session cookie (HttpOnly, set by passkey/Google/Apple login on the site):
// with host_permissions granted, fetch() from the extension's service worker
// sends it automatically via credentials: "include". No tokens are ever
// stored in extension storage — nothing to steal from chrome.storage.
//
// The base URL is configurable (Settings tab) so dev builds can point at
// http://localhost:3000.
// ---------------------------------------------------------------------------

// Dev builds (`wxt dev`) talk to the local backend by default; production
// builds talk to furlpay.com. Both are overridable in Settings.
const DEFAULT_BASE = import.meta.env.DEV ? "http://localhost:3000" : "https://furlpay.com";

export async function getBaseUrl(): Promise<string> {
  const { baseUrl } = await browser.storage.local.get("baseUrl");
  return typeof baseUrl === "string" && baseUrl ? baseUrl : DEFAULT_BASE;
}

export async function setBaseUrl(url: string): Promise<void> {
  await browser.storage.local.set({ baseUrl: url.replace(/\/+$/, "") });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-FurlPay-Extension": browser.runtime.getManifest().version,
      ...init.headers,
    },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

/** Wrap a promise into the message-passing envelope. */
export async function toResponse<T>(work: Promise<T>): Promise<BgResponse<T>> {
  try {
    return { ok: true, data: await work };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
