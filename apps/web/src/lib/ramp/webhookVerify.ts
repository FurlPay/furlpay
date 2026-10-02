import { createHmac, timingSafeEqual } from "crypto";
import { rampEnv } from "@/lib/providers/rampEnv";

// ---------------------------------------------------------------------------
// Ramp-partner webhook verification. AGENTS.md rule 3: verify a signature over
// the received bytes with a constant-time compare, reject stale events, and
// fail closed when the secret is unset.
//
// FurlBridge (Transak). Transak does NOT send a signature header. Its
// documented scheme (docs.transak.com/guides/how-to-decrypt-webhook-payload,
// checked 2026-10-02) is a body `{ "data": "<JWT>" }` where the JWT is HS256
// over the claims `{ webhookData, eventID, createdAt }`, keyed with the Partner
// Access Token. An earlier draft here verified an `x-transak-signature` HMAC
// header that Transak never sends — it would have rejected every real event
// and accepted anything signed with a secret only we held.
//
// FurlPayout (Echo Money) has no verifier: its webhook scheme is not in any
// document we could retrieve (docs.echo.money renders client-side; nothing
// states headers or algorithm). Inventing one would be the same mistake.
// ---------------------------------------------------------------------------

export class WebhookSignatureError extends Error {
  constructor(provider: string, reason: string) {
    super(`[${provider}] webhook verification failed: ${reason}`);
    this.name = "WebhookSignatureError";
  }
}

/** Events older than this are refused even with a valid signature (replay). */
export const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

const b64urlDecode = (s: string): Buffer => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/**
 * Verify an HS256 JWT and return its claims. Only HS256 is accepted: the
 * header's `alg` is checked, never trusted to choose the algorithm, so a
 * `none` or RS256 token cannot downgrade the check.
 */
export function verifyHs256Jwt(provider: string, token: string, key: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) {
    throw new WebhookSignatureError(provider, "malformed JWT");
  }
  const [h, p, s] = parts;
  let header: { alg?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlDecode(h).toString("utf8"));
    claims = JSON.parse(b64urlDecode(p).toString("utf8"));
  } catch {
    throw new WebhookSignatureError(provider, "JWT is not JSON");
  }
  if (header.alg !== "HS256") throw new WebhookSignatureError(provider, "unexpected JWT alg");

  const expected = createHmac("sha256", key).update(`${h}.${p}`).digest();
  const received = b64urlDecode(s);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new WebhookSignatureError(provider, "signature does not match");
  }
  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) {
    throw new WebhookSignatureError(provider, "JWT expired");
  }
  return claims;
}

export interface FurlBridgeEvent {
  /** Transak's event type, e.g. ORDER_COMPLETED — NOT unique per delivery. */
  eventType: string;
  orderId: string;
  status: string;
  partnerOrderId?: string;
  transactionHash?: string;
  createdAt: string;
  /** Stable per (order, event, status): the dedupe key for retries. */
  dedupeKey: string;
  webhookData: Record<string, unknown>;
}

/** Verify a FurlBridge (Transak) webhook body and return the event. */
export function verifyFurlBridgeWebhook(rawBody: string, now = Date.now()): FurlBridgeEvent {
  const key = rampEnv("FURLBRIDGE_ACCESS_TOKEN");
  if (!key) {
    throw new WebhookSignatureError("furlbridge", "FURLBRIDGE_ACCESS_TOKEN is not set — fail closed");
  }
  let body: { data?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new WebhookSignatureError("furlbridge", "body is not JSON");
  }
  if (typeof body?.data !== "string") throw new WebhookSignatureError("furlbridge", "missing data JWT");

  const claims = verifyHs256Jwt("furlbridge", body.data, key);
  const wd = claims.webhookData as Record<string, unknown> | undefined;
  const eventType = claims.eventID;
  const createdAt = claims.createdAt;
  if (!wd || typeof wd.id !== "string" || typeof wd.status !== "string" || typeof eventType !== "string") {
    throw new WebhookSignatureError("furlbridge", "missing webhookData.id, status or eventID");
  }
  const created = typeof createdAt === "string" ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(created) || now - created > MAX_EVENT_AGE_MS || created - now > 5 * 60_000) {
    throw new WebhookSignatureError("furlbridge", "event timestamp missing or outside the accepted window");
  }
  return {
    eventType,
    orderId: wd.id,
    status: wd.status,
    partnerOrderId: typeof wd.partnerOrderId === "string" ? wd.partnerOrderId : undefined,
    transactionHash: typeof wd.transactionHash === "string" ? wd.transactionHash : undefined,
    createdAt: createdAt as string,
    dedupeKey: `${wd.id}:${eventType}:${wd.status}`,
    webhookData: wd,
  };
}
