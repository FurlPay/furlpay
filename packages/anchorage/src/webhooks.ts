// ---------------------------------------------------------------------------
// Anchorage Digital webhook verification.
//
// Anchorage signs webhook payloads with Ed25519 so receivers can verify
// authenticity without sharing a secret. The receiver verifies the signature
// against Anchorage's published webhook signing public key.
//
// Idempotent processing: webhook events carry an eventId that the receiver
// should track to avoid processing duplicates. Anchorage retries failed
// deliveries, so the same event may arrive multiple times.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import type { AnchorageWebhookEvent, WebhookEventType } from "./types.js";

/** Configuration for webhook verification. */
export interface WebhookVerifierConfig {
  /** Anchorage's webhook signing public key in PEM format. */
  signingPublicKey: string;
  /** Maximum age of a webhook event in seconds. Default: 300. */
  maxAgeSecs?: number;
}

/** Result of webhook verification. */
export interface WebhookVerifyResult {
  valid: boolean;
  event?: AnchorageWebhookEvent;
  reason?: string;
}

/**
 * Verify and parse an incoming Anchorage webhook event.
 *
 * Checks:
 *   1. The payload is valid JSON with required fields.
 *   2. The Ed25519 signature matches the payload.
 *   3. The event is not too old (replay protection).
 *
 * @param rawBody   - The raw HTTP request body as a string.
 * @param signature - The signature from the `X-Anchorage-Signature` header.
 * @param config    - Verification configuration.
 * @returns Verification result with the parsed event on success.
 */
export function verifyWebhook(
  rawBody: string,
  signature: string,
  config: WebhookVerifierConfig
): WebhookVerifyResult {
  const maxAge = (config.maxAgeSecs ?? 300) * 1000;

  // 1. Parse the payload
  let event: AnchorageWebhookEvent;
  try {
    event = JSON.parse(rawBody) as AnchorageWebhookEvent;
  } catch {
    return { valid: false, reason: "Malformed JSON body" };
  }

  if (!event.eventId || !event.eventType || !event.timestamp) {
    return { valid: false, reason: "Missing required fields (eventId, eventType, timestamp)" };
  }

  // 2. Verify the Ed25519 signature
  try {
    const key = crypto.createPublicKey(config.signingPublicKey);
    const valid = crypto.verify(
      null,
      new Uint8Array(Buffer.from(rawBody)),
      key,
      new Uint8Array(Buffer.from(signature, "base64"))
    );
    if (!valid) {
      return { valid: false, reason: "Signature verification failed" };
    }
  } catch (e) {
    return { valid: false, reason: `Signature verification error: ${(e as Error).message}` };
  }

  // 3. Freshness check
  const eventTime = Date.parse(event.timestamp);
  if (Number.isNaN(eventTime)) {
    return { valid: false, reason: "Invalid timestamp format" };
  }
  const age = Date.now() - eventTime;
  if (age > maxAge) {
    return { valid: false, reason: `Event too old (${Math.round(age / 1000)}s > ${config.maxAgeSecs ?? 300}s)` };
  }

  return { valid: true, event };
}

/**
 * Simple in-memory event deduplicator.
 *
 * Tracks seen eventIds and returns false for duplicates. In production, use
 * Redis or a database for deduplication across instances.
 */
export class EventDeduplicator {
  private readonly seen = new Set<string>();
  private readonly maxSize: number;

  constructor(maxSize = 10_000) {
    this.maxSize = maxSize;
  }

  /**
   * Record an event as seen. Returns true if this is the first time,
   * false if it's a duplicate.
   */
  isDuplicate(eventId: string): boolean {
    if (this.seen.has(eventId)) return true;
    // Evict oldest if at capacity (Set preserves insertion order)
    if (this.seen.size >= this.maxSize) {
      const first = this.seen.values().next().value;
      if (first !== undefined) this.seen.delete(first);
    }
    this.seen.add(eventId);
    return false;
  }
}

// ── Typed event handlers ────────────────────────────────────────────────────

/** Map of event type to handler function. */
export type WebhookHandlers = Partial<
  Record<WebhookEventType, (event: AnchorageWebhookEvent) => void | Promise<void>>
>;

/**
 * Dispatch a verified webhook event to the appropriate handler.
 *
 * @param event    - The verified webhook event.
 * @param handlers - Map of event type to handler function.
 * @returns True if a handler was found and executed.
 */
export async function dispatchWebhook(
  event: AnchorageWebhookEvent,
  handlers: WebhookHandlers
): Promise<boolean> {
  const handler = handlers[event.eventType];
  if (!handler) return false;
  await handler(event);
  return true;
}
