// ---------------------------------------------------------------------------
// THE cross-platform analytics event contract (schema version 1).
//
// One definition for web, chrome_extension, android, ios and api. The clients
// carry their own copies of the client event list (apps/extension/lib/
// analytics.ts, native-app/lib/analytics/furlpaySink.ts) and a parity test
// fails CI if any copy drifts from this file. Migration 0028 enforces the same
// names in the database CHECK, so a name added here without a migration fails
// loudly at insert, not silently.
//
// Rules this file encodes:
//   - Platform, event name, timestamp, versions: closed sets / strict formats.
//   - Identity is NEVER part of the payload: the server derives user_id from
//     the session. A payload carrying a user id is rejected, not ignored.
//   - Client events are informational. Completion of money movement, KYC
//     outcomes and settlement are SERVER_ONLY and refused from clients.
//   - Metadata: allowlisted keys, primitive values, short strings. No nesting.
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;

export const PLATFORMS = ["web", "chrome_extension", "android", "ios", "api"] as const;
export type Platform = (typeof PLATFORMS)[number];
/** Platforms a CLIENT may report; "api" is the server itself. */
export const CLIENT_PLATFORMS = ["web", "chrome_extension", "android", "ios"] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

export const CLIENT_EVENTS = [
  "app_opened",
  "page_viewed",
  "screen_viewed",
  "signup_started_client",
  "login_started",
  "wallet_connected",
  "wallet_disconnected",
  "transaction_viewed",
  "transaction_requested",
  "transaction_approved",
  "transaction_rejected",
  "transaction_submitted",
  "payment_started",
  "swap_started",
  "deposit_started",
  "withdrawal_started",
  "travel_search",
  "travel_booking_started",
  "extension_installed",
  "extension_started",
  "extension_connected",
  "extension_disconnected",
  "error_occurred",
] as const;
export type ClientEventName = (typeof CLIENT_EVENTS)[number];

/** Facts only the backend, a provider or the chain can establish. Refused from clients. */
export const SERVER_ONLY_EVENTS = [
  "signup_completed",
  "login",
  "login_completed",
  "logout",
  "kyc_completed",
  "kyc_started",
  "wallet_linked",
  "cashback_claimed",
  "payment_completed",
  "payment_authorized",
  "transaction_settled",
  "transaction_confirmed",
  "transaction_finalized",
  "transaction_completed",
  "deposit_completed",
  "deposit_confirmed",
  "withdrawal_completed",
  "swap_completed",
  "card_created",
  "card_payment_authorized",
  "card_payment_settled",
  "travel_booking_completed",
  "booking_confirmed",
] as const;

export const LIMITS = {
  batchMaxEvents: 50,
  bodyMaxBytes: 64 * 1024,
  eventIdMax: 64,
  stringMax: 64,
  routeMax: 120,
  metadataMaxKeys: 10,
  maxAgeMs: 7 * 86_400_000, // older events are dropped: they are stale queues
  maxFutureSkewMs: 5 * 60_000,
} as const;

/** Keys a client may attach. Values are primitives; strings are bounded. */
const METADATA_KEYS = new Set([
  "source", "method", "outcome", "reason", "errorCode", "chain", "token", "bucket",
  "provider", "rail", "step", "destinationType", "durationBucket", "count",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^[0-9]{1,4}(\.[0-9]{1,4}){0,3}([-+][0-9A-Za-z.]{1,20})?$/;
const BUILD = /^[0-9A-Za-z.]{1,20}$/;
const SCREEN = /^[A-Za-z0-9_./-]{1,64}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
// Compared case- and separator-insensitively: "UserId", "user-id" and "EMAIL"
// are the same claim as "userId" and "email".
const IDENTITY_KEYS = new Set(["userid", "uid", "accountid", "email", "sub"]);
const claimsIdentity = (o: unknown): boolean =>
  !!o && typeof o === "object" && Object.keys(o).some((k) => IDENTITY_KEYS.has(k.toLowerCase().replace(/[_\-.]/g, "")));

// Values that are personal data whatever key they arrive under: an email, an
// EVM or Solana address, or a long digit run (card, phone, account number).
// Analytics never needs them, so they are dropped rather than stored.
const PERSONAL_VALUE = /[^\s@/]+@[^\s@/]+\.[^\s@/]+|0x[0-9a-f]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|\d{9,}/i;

export interface ClientEventInput {
  schemaVersion?: number;
  eventId: string;
  eventName: string;
  platform: string;
  timestamp: string;
  appVersion?: string;
  buildNumber?: string;
  osVersion?: string;
  sessionId?: string;
  installationId?: string;
  anonId?: string;
  route?: string;
  screen?: string;
  transactionId?: string;
  metadata?: Record<string, unknown>;
}

export interface ValidClientEvent {
  eventId: string;
  eventName: ClientEventName;
  platform: ClientPlatform;
  clientTs: string;
  schemaVersion: number;
  appVersion: string | null;
  buildNumber: string | null;
  osVersion: string | null;
  sessionId: string | null;
  installationId: string | null;
  anonId: string | null;
  route: string | null;
  screen: string | null;
  transactionId: string | null;
  metadata: Record<string, string | number | boolean>;
}

export type Rejection =
  | "not_an_object"
  | "identity_claim"
  | "unsupported_schema"
  | "bad_event_id"
  | "server_only_event"
  | "unknown_event"
  | "bad_platform"
  | "bad_timestamp"
  | "too_old"
  | "in_future"
  | "bad_version"
  | "bad_id"
  | "bad_screen";

/** Path only: query strings and fragments can carry tokens and are never stored. */
export function sanitizeRoute(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  const path = raw.split(/[?#]/, 1)[0];
  // Long opaque path segments (ids, tokens, addresses) become ":id".
  const cleaned = path
    .split("/")
    .map((seg) =>
      seg.length > 24 || /^[0-9a-f-]{16,}$/i.test(seg) || /^0x[0-9a-f]{8,}$/i.test(seg) || seg.includes("@") || PERSONAL_VALUE.test(seg) ? ":id" : seg
    )
    .join("/");
  return cleaned.slice(0, LIMITS.routeMax);
}

export function sanitizeMetadata(raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= LIMITS.metadataMaxKeys) break;
    if (!METADATA_KEYS.has(k)) continue;
    if (typeof v === "string") {
      if (!PERSONAL_VALUE.test(v)) out[k] = v.slice(0, LIMITS.stringMax);
    }
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    // objects, arrays, null, functions: dropped
  }
  return out;
}

const opt = (v: unknown, re: RegExp): string | null | false =>
  v === undefined || v === null || v === "" ? null : typeof v === "string" && re.test(v) ? v : false;

export function validateClientEvent(raw: unknown, now = Date.now()): { ok: true; event: ValidClientEvent } | { ok: false; reason: Rejection } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not_an_object" };
  const e = raw as Record<string, unknown>;
  // Identity comes from the session. A payload naming a user is either a bug or
  // an attempt to act as someone else; either way it is refused.
  if (claimsIdentity(e) || claimsIdentity(e.metadata)) {
    return { ok: false, reason: "identity_claim" };
  }
  const schemaVersion = e.schemaVersion === undefined ? 1 : e.schemaVersion;
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly unknown[]).includes(schemaVersion)) return { ok: false, reason: "unsupported_schema" };
  if (typeof e.eventId !== "string" || !EVENT_ID.test(e.eventId)) return { ok: false, reason: "bad_event_id" };
  if (typeof e.eventName !== "string") return { ok: false, reason: "unknown_event" };
  if ((SERVER_ONLY_EVENTS as readonly string[]).includes(e.eventName)) return { ok: false, reason: "server_only_event" };
  if (!(CLIENT_EVENTS as readonly string[]).includes(e.eventName)) return { ok: false, reason: "unknown_event" };
  if (!(CLIENT_PLATFORMS as readonly string[]).includes(e.platform as string)) return { ok: false, reason: "bad_platform" };
  const ts = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_timestamp" };
  if (now - ts > LIMITS.maxAgeMs) return { ok: false, reason: "too_old" };
  if (ts - now > LIMITS.maxFutureSkewMs) return { ok: false, reason: "in_future" };
  const appVersion = opt(e.appVersion, VERSION);
  const buildNumber = opt(e.buildNumber, BUILD);
  const osVersion = opt(e.osVersion, /^[A-Za-z0-9 ._-]{1,40}$/);
  if (appVersion === false || buildNumber === false || osVersion === false) return { ok: false, reason: "bad_version" };
  const sessionId = opt(e.sessionId, UUID);
  const installationId = opt(e.installationId, UUID);
  const anonId = opt(e.anonId, UUID);
  if (sessionId === false || installationId === false || anonId === false) return { ok: false, reason: "bad_id" };
  const screen = opt(e.screen, SCREEN);
  if (screen === false) return { ok: false, reason: "bad_screen" };
  const transactionId = typeof e.transactionId === "string" && /^[A-Za-z0-9_:-]{4,80}$/.test(e.transactionId) ? e.transactionId : null;
  return {
    ok: true,
    event: {
      eventId: e.eventId,
      eventName: e.eventName as ClientEventName,
      platform: e.platform as ClientPlatform,
      clientTs: new Date(ts).toISOString(),
      schemaVersion: schemaVersion as number,
      appVersion,
      buildNumber,
      osVersion,
      sessionId,
      installationId,
      anonId,
      route: sanitizeRoute(e.route),
      screen,
      transactionId,
      metadata: sanitizeMetadata(e.metadata),
    },
  };
}
