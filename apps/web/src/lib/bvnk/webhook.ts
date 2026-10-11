import { createHmac, timingSafeEqual } from "node:crypto";
import {
  customerEvent, payinEvent, payoutEvent, transferEvent, walletEvent, webhookEnvelope,
  CUSTOMER_STATUS, PAYIN_V2, PAYOUT_V2, TRANSFER_V3, WALLET_V2,
} from "./schemas";

// BVNK webhook verification (https://docs.bvnk.com/bvnk/get-started/create-webhook-listener):
//   x-signature = base64(HMAC-SHA256(secret as UTF-8 bytes, raw body as UTF-8 bytes))
// computed over the raw body exactly as received — never a re-serialised object.
// The published test vector (secret, payload, signature) is in the tests.
//
// BVNK sends no signature timestamp header. Replay of a captured delivery is
// handled by durable de-duplication on eventId (webhook_events, 0022) and by
// refusing events whose own `timestamp` is older than the redelivery window:
// BVNK retries for up to about 24 hours, so a week-old event is a replay.

const SIG_BYTES = 32;
const BASE64 = /^[A-Za-z0-9+/]{43}=$/;
export const MAX_EVENT_AGE_MS = 7 * 86_400_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/** Constant-time check of x-signature against the raw body. */
export function verifyBvnkSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !BASE64.test(signature)) return false;
  const received = Buffer.from(signature, "base64");
  if (received.length !== SIG_BYTES) return false;
  const expected = createHmac("sha256", Buffer.from(secret, "utf8")).update(Buffer.from(rawBody, "utf8")).digest();
  return timingSafeEqual(received, expected);
}

export type ParsedBvnkEvent =
  | { kind: "payin"; event: ReturnType<typeof payinEvent.parse> }
  | { kind: "payout"; event: ReturnType<typeof payoutEvent.parse> }
  | { kind: "transfer"; event: ReturnType<typeof transferEvent.parse> }
  | { kind: "wallet"; event: ReturnType<typeof walletEvent.parse> }
  | { kind: "customer"; event: ReturnType<typeof customerEvent.parse> }
  | { kind: "unhandled"; event: ReturnType<typeof webhookEnvelope.parse> };

export class BvnkEventInvalid extends Error {}

const parsers = {
  [PAYIN_V2]: ["payin", payinEvent],
  [PAYOUT_V2]: ["payout", payoutEvent],
  [TRANSFER_V3]: ["transfer", transferEvent],
  [WALLET_V2]: ["wallet", walletEvent],
  [CUSTOMER_STATUS]: ["customer", customerEvent],
} as const;

/**
 * Parse a VERIFIED body. Events FurlPay has a contract for are validated
 * against it; any other event type is returned as "unhandled" (recorded, no
 * effect). A known event that does not match its contract, an unparseable
 * body or a stale/future timestamp is invalid — a permanent condition.
 */
export function parseBvnkEvent(rawBody: string, now = Date.now()): ParsedBvnkEvent {
  let json: unknown;
  try { json = JSON.parse(rawBody); } catch { throw new BvnkEventInvalid("body is not JSON"); }
  const env = webhookEnvelope.safeParse(json);
  if (!env.success) throw new BvnkEventInvalid("not a BVNK webhook envelope");
  const at = Date.parse(env.data.timestamp);
  if (!Number.isFinite(at)) throw new BvnkEventInvalid("event timestamp is not a date");
  if (now - at > MAX_EVENT_AGE_MS) throw new BvnkEventInvalid("event is older than the redelivery window");
  if (at - now > MAX_CLOCK_SKEW_MS) throw new BvnkEventInvalid("event timestamp is in the future");
  const entry = parsers[env.data.event as keyof typeof parsers];
  if (!entry) return { kind: "unhandled", event: env.data };
  const [kind, schema] = entry;
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new BvnkEventInvalid(`${env.data.event} does not match its contract: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  return { kind, event: parsed.data } as ParsedBvnkEvent;
}
