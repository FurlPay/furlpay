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

/**
 * Backends this extension is permitted to talk to.
 *
 * This is the same set as `host_permissions` in wxt.config.ts, and it has to
 * stay that way: a base URL outside those permissions produces a fetch that
 * fails CORS, which surfaces to the user as "everything is broken" with no
 * explanation anywhere.
 *
 * The AWS environments are included because the clients are being repointed at
 * them; localhost only outside a production build, exactly as the manifest does
 * it. Add a host here and you must add it to `host_permissions` too.
 */
const ALLOWED_ORIGINS: readonly string[] = [
  "https://furlpay.com",
  "https://www.furlpay.com",
  "https://api.furlpay.com",
  // Non-production only, MIRRORING the manifest exactly. A published listing
  // does not carry host permissions for staging or dev, so allowing them here
  // would let the user select a backend the browser then refuses to reach.
  ...(import.meta.env.DEV
    ? [
        "https://api-staging.furlpay.com",
        "https://api-dev.furlpay.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
      ]
    : []),
];

export class InvalidBaseUrlError extends Error {}

/**
 * Normalise a candidate backend URL, or reject it.
 *
 * `setBaseUrl` used to persist whatever string it was handed, straight from a
 * free-text field in Settings — no scheme check, no host check. Host
 * permissions bounded the damage (a fetch elsewhere simply fails), so this was
 * never a live exploit. It was, though, a control with no floor: the failure
 * mode of a mistyped or pasted value was silent breakage, and the only thing
 * standing between a user talked into pasting a URL and their request bodies
 * going elsewhere was a manifest they cannot see.
 *
 * @returns the normalised origin-plus-path, trailing slashes removed.
 * @throws InvalidBaseUrlError when the URL is unparseable or not allow-listed.
 */
export function normalizeBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new InvalidBaseUrlError("That is not a valid URL.");
  }
  // Compared on ORIGIN, so a path, query or credentials in the input cannot
  // smuggle a different host past a string prefix check.
  if (!ALLOWED_ORIGINS.includes(parsed.origin)) {
    throw new InvalidBaseUrlError(
      `${parsed.origin} is not a FurlPay backend. Allowed: ${ALLOWED_ORIGINS.join(", ")}`
    );
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

export async function getBaseUrl(): Promise<string> {
  const { baseUrl } = await browser.storage.local.get("baseUrl");
  if (typeof baseUrl !== "string" || !baseUrl) return DEFAULT_BASE;
  // Re-validated on READ, not only on write. Extension storage is writable by
  // anything with access to the profile directory, and a value that predates
  // this allowlist (or was written by an older build) must not be honoured
  // just because it is already persisted.
  try {
    return normalizeBaseUrl(baseUrl);
  } catch {
    return DEFAULT_BASE;
  }
}

export async function setBaseUrl(url: string): Promise<void> {
  await browser.storage.local.set({ baseUrl: normalizeBaseUrl(url) });
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
