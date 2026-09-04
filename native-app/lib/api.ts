import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

// ---------------------------------------------------------------------------
// API client → the same furlpay.com/api the web app uses. The session JWT is
// held in the Android Keystore (SecureStore) and sent as Authorization: Bearer
// (server support added in apps/web/src/lib/session.ts::tokenFromRequest).
// ---------------------------------------------------------------------------

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? "https://furlpay.com/api";

const TOKEN_KEY = "furlpay.session";

/**
 * Who we tell the server we are.
 *
 * MUST START WITH "mobile". This is not cosmetic: apps/web/src/lib/clientKind.ts
 * returns the session JWT in the response BODY only for clients whose
 * X-Furlpay-Client starts with `mobile` — everything else is treated as a
 * browser and gets an HttpOnly cookie the app cannot read. Change the prefix and
 * every sign-in path fails at the "no token in the response" step.
 *
 * THE VERSION IS READ FROM THE MANIFEST, NOT TYPED HERE. It was hardcoded to
 * "2.1.0" and stayed there while app.json moved to 2.3.0 — so every request
 * from the last two releases identified itself as a version that had not
 * shipped for months. Nothing broke loudly, which is the problem: this string
 * is what server-side telemetry, minimum-version checks and per-client rollouts
 * read, and all three were quietly answering questions about the wrong build.
 * Sourcing it from the same manifest the build stamps means it cannot drift.
 *
 * The fallback exists for a test renderer with no Expo manifest; it is a marker,
 * not a plausible version, so an unknown build is visible in logs rather than
 * disguised as a real one.
 */
const CLIENT_VERSION = Constants.expoConfig?.version ?? "0.0.0-unknown";
const CLIENT_HEADER = `mobile-android/${CLIENT_VERSION}`;

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Sliding session refresh. The session JWT lives 1h; without refresh the first
// API call after expiry 401s and the unauthorized handler force-signs the user
// out mid-use. Instead: when a request finds the token inside its last
// REFRESH_MARGIN, it first swaps it at POST /auth/refresh (single-flight, so
// a burst of parallel calls refreshes once). The server carries the original
// auth_time forward and refuses after 30 days — at which point the refresh
// 401s, the original request 401s, and the existing sign-out path takes over.
// ---------------------------------------------------------------------------

const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/** exp (ms) from a JWT without verifying it — the server re-verifies anyway;
 *  we only need a clock to schedule the refresh. No atob: Hermes' availability
 *  varies by RN version and this must never throw. */
export function tokenExpiryMs(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bits = 0;
    let acc = 0;
    let json = "";
    for (const ch of b64) {
      const v = alphabet.indexOf(ch);
      if (v < 0) continue; // padding
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        json += String.fromCharCode((acc >> bits) & 0xff);
      }
    }
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

let refreshInFlight: Promise<void> | null = null;

async function refreshTokenIfExpiring(): Promise<void> {
  const token = await getToken();
  if (!token) return;
  const exp = tokenExpiryMs(token);
  if (exp === null || exp - Date.now() > REFRESH_MARGIN_MS) return;
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: {
          "X-Furlpay-Client": CLIENT_HEADER,
          Authorization: `Bearer ${token}`,
        },
      });
      const data = res.ok ? ((await res.json()) as { token?: string }) : null;
      if (data?.token) await setToken(data.token);
      // Failure (offline, already expired, 30-day ceiling) is NOT handled here:
      // the request that triggered us proceeds with the old token and the
      // normal 401 path decides what happens.
    } catch {
      /* offline — proceed with the old token */
    } finally {
      refreshInFlight = null;
    }
  })();
  await refreshInFlight;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  /** Correlation id for this request — echoed by the server, present in its
   *  logs. Surfaced to the user on money-path failures so a support ticket can
   *  be tied to the exact server-side request. */
  correlationId?: string;
  constructor(status: number, message: string, data?: unknown, correlationId?: string) {
    super(message);
    this.status = status;
    this.data = data;
    this.correlationId = correlationId;
  }
}

/** Thrown when the device is offline / the request never reached the server. */
export class NetworkError extends Error {}

// The auth store registers itself here so a 401 anywhere forces re-login
// without api.ts importing the store (no cycle).
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip the 401 → sign-out hook (used by auth endpoints themselves). */
  anonymous?: boolean;
  /** Abort the in-flight request. Callers that re-issue a request as the user
   *  types (live quoting) MUST pass one: without it a slow earlier response can
   *  land after a newer one and repaint the screen with a stale price. */
  signal?: AbortSignal;
}

/** Thrown when the caller aborted via `opts.signal` — a superseded request, not
 *  a failure. Callers should swallow it rather than showing an error. */
export class AbortedError extends Error {}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  // Swap an about-to-expire token BEFORE using it (no-op with >10min left).
  if (!opts.anonymous) await refreshTokenIfExpiring();
  const token = opts.anonymous ? null : await getToken();
  // Per-request correlation id — the server echoes it and logs it, so a failure
  // the user reports can be traced to the exact server-side request.
  const correlationId = crypto.randomUUID();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Furlpay-Client": CLIENT_HEADER,
        "X-Correlation-Id": correlationId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    // An abort is the caller superseding itself — distinguish it from a real
    // connectivity failure so it never queues an outbox action or shows an error.
    if (opts.signal?.aborted) throw new AbortedError("Request superseded.");
    throw new NetworkError((e as Error).message);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !opts.anonymous) onUnauthorized?.();
    const message =
      (data && typeof data === "object" && "error" in data && String((data as any).error)) ||
      `Request failed (${res.status})`;
    // Prefer the server's echoed id; fall back to the one we sent.
    const cid = res.headers.get("x-correlation-id") || correlationId;
    throw new ApiError(res.status, message, data, cid);
  }
  return data as T;
}

/** Random 65-byte ECDSA-shaped hex blob — the demo transfer authorization the
 *  web dashboard also sends (see apps/web/src/lib/signature.ts, mock recovery). */
export function demoSignature(): string {
  const bytes = new Uint8Array(65);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
