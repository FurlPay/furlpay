import * as SecureStore from "expo-secure-store";

// ---------------------------------------------------------------------------
// API client → the same furlpay.com/api the web app uses. The session JWT is
// held in the Android Keystore (SecureStore) and sent as Authorization: Bearer
// (server support added in apps/web/src/lib/session.ts::tokenFromRequest).
// ---------------------------------------------------------------------------

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? "https://furlpay.com/api";

const TOKEN_KEY = "furlpay.session";
const CLIENT_HEADER = "mobile-android/2.0.0";

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
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
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = opts.anonymous ? null : await getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Furlpay-Client": CLIENT_HEADER,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new NetworkError((e as Error).message);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !opts.anonymous) onUnauthorized?.();
    const message =
      (data && typeof data === "object" && "error" in data && String((data as any).error)) ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, message, data);
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
