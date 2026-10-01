import { createHmac } from "crypto";
import { after } from "next/server";
import { sbInsertIgnoreDuplicates, supabaseBackend } from "@/lib/supabase";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Product lifecycle events (table analytics_events, migration 0027).
//
// ONLY facts the product actually produces, each recorded where it happens:
//
//   signup_started    an identity with NO account requests a sign-in code   auth/otp/start
//   signup_completed  an account is created (OTP, Google, Apple)             auth/otp/check, google, apple
//   login             an existing account signs in                           auth/otp/check, google, apple
//   logout            a session is ended by the user                         auth/logout
//   kyc_started       an identity-verification session is created            compliance/verify
//   kyc_completed     the provider reports the verification passed           webhooks/persona, sumsub
//   cashback_claimed  a cashback claim is paid                               membership/cashback/claim
//
// NOT here, deliberately: money. Volume, fees and transaction counts come from
// the ops ledger (ops_tx_events); an analytics row is never a financial record.
// Wallet links come from linked_wallets (it already has linked_at).
//
// NEVER BLOCKS OR FAILS THE CALLER. Writes run after the response (next/server
// after()), with a 2-second bound and one retry; a failure is logged and
// counted, never thrown. A login, payment or KYC callback succeeds whether or
// not this table is reachable.
//
// IDEMPOTENT. event_id is derived from the business fact (signup_completed:
// <user>, kyc_completed:<user>, cashback_claimed:<effect key>…) and inserted
// with ignore-duplicates, so a retried request or a redelivered webhook does
// not count twice. It is never used as a FINANCIAL idempotency key.
//
// NO PII. No email, phone, name, IP, address or token is stored. `subject` is
// HMAC-SHA256(server secret, canonical identifier): it links a signup start to
// its completion and cannot be reversed without the secret. Metadata passes an
// allowlist of short, non-identifying keys.
// ---------------------------------------------------------------------------

export type ProductEventName =
  | "signup_started"
  | "signup_completed"
  | "login"
  | "logout"
  | "kyc_started"
  | "kyc_completed"
  | "cashback_claimed";

const META_KEYS = new Set(["provider", "channel", "tier", "method"]);
const TIMEOUT_MS = 2_000;

export interface ProductEvent {
  name: ProductEventName;
  /** Deterministic for the business fact. Prefixed with the name if not already. */
  eventId: string;
  userId?: string | null;
  /** Raw identifier to pseudonymise (canonical email or E.164 phone). Hashed here, never stored. */
  subjectOf?: string | null;
  route?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
}

let failures = 0;
export const productEventFailures = () => failures;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HMAC of a canonical identifier with the server secret, or null without one. */
export function subjectHash(identifier: string, secret = process.env.FURLPAY_SESSION_SECRET): string | null {
  if (!secret || !identifier) return null;
  return createHmac("sha256", secret).update(`analytics-subject:${identifier}`).digest("hex");
}

export function buildEventRow(e: ProductEvent, now = new Date()) {
  const metadata: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(e.metadata ?? {})) {
    if (!META_KEYS.has(k) || v === undefined) continue;
    metadata[k] = typeof v === "string" ? v.slice(0, 40) : v;
  }
  const id = e.eventId.startsWith(`${e.name}:`) ? e.eventId : `${e.name}:${e.eventId}`;
  return {
    event_id: id.slice(0, 160),
    event_name: e.name,
    // user_id is a uuid column: anything else (a demo id) is dropped, not coerced.
    user_id: e.userId && UUID.test(e.userId) ? e.userId : null,
    subject: e.subjectOf ? subjectHash(e.subjectOf) : null,
    source: "server" as const,
    platform: "api" as const,
    // No user yet (signup_started) is an anonymous actor; 0028 enforces the pairing.
    actor_type: (e.userId && UUID.test(e.userId) ? "user" : "anonymous") as "user" | "anonymous",
    route: e.route ? e.route.slice(0, 120) : null,
    metadata,
    created_at: now.toISOString(),
  };
}

async function write(row: ReturnType<typeof buildEventRow>): Promise<void> {
  if (supabaseBackend !== "supabase") return; // no durable store (development)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sbInsertIgnoreDuplicates("analytics_events", row, AbortSignal.timeout(TIMEOUT_MS));
      return;
    } catch (e) {
      if (attempt === 1) {
        failures++;
        log.warn("analytics event not recorded", { event: row.event_name, error: (e as Error).message.slice(0, 120) });
      }
    }
  }
}

/** Record after the response is sent. Never throws, never awaits on the request path. */
export function recordProductEvent(e: ProductEvent): void {
  let row: ReturnType<typeof buildEventRow>;
  try {
    row = buildEventRow(e);
  } catch {
    failures++;
    return;
  }
  try {
    after(() => write(row));
  } catch {
    // Outside a request scope (scripts, some tests): write in the background.
    void write(row);
  }
}

/**
 * signup_started: an identity that has NO account requests a sign-in code.
 * The account lookup runs AFTER the response, so this adds no latency and no
 * timing difference between known and unknown identities to /auth/otp/start.
 * Idempotent per identity per UTC day: re-requesting a code is one start.
 */
export function recordSignupStartedIfNew(
  identifier: string,
  channel: string,
  hasAccount: (identifier: string) => Promise<boolean>,
  now = new Date()
): void {
  const subject = subjectHash(identifier);
  if (!subject) return; // no secret configured: nothing pseudonymous to link with
  const task = async () => {
    try {
      if (await hasAccount(identifier)) return;
    } catch {
      return; // unknown: record nothing rather than guess
    }
    await write(
      buildEventRow(
        { name: "signup_started", eventId: `${subject}:${now.toISOString().slice(0, 10)}`, subjectOf: identifier, route: "/api/auth/otp/start", metadata: { channel } },
        now
      )
    );
  };
  try {
    after(task);
  } catch {
    void task();
  }
}
