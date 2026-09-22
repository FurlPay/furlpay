import { timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Webhook idempotency guard.
//
// THE PROBLEM: Webhook providers (Stripe, Circle, provider banks) retry
// delivery. Without deduplication, the same payment notification creates
// duplicate ledger entries — the exact "double credit" that lifecycle.ts
// was designed to prevent.
//
// THIS MODULE: tracks webhook event IDs and rejects duplicates before
// they reach the handler. Uses the same atomic check-and-set pattern
// as the x402-guard nonce linearization.
// ---------------------------------------------------------------------------

export interface WebhookEvent {
  id: string;              // Provider's event ID
  provider: string;        // "stripe" | "circle" | "transak" etc.
  type: string;            // Event type
  receivedAt: string;
  processed: boolean;
  processedAt?: string;
  idempotencyKey: string;  // Derived: provider + eventId
}

// In-memory store for idempotency keys, for demo purposes.
// Should be replaced with Redis or Database in production.
const eventStore = new Map<string, WebhookEvent>();

export function isNewEvent(provider: string, eventId: string, eventType: string = "unknown"): boolean {
  const idempotencyKey = `${provider}:${eventId}`;
  
  if (eventStore.has(idempotencyKey)) {
    return false;
  }

  // Atomic check-and-set
  eventStore.set(idempotencyKey, {
    id: eventId,
    provider,
    type: eventType,
    receivedAt: new Date().toISOString(),
    processed: false,
    idempotencyKey,
  });

  return true;
}

export function markProcessed(provider: string, eventId: string): void {
  const idempotencyKey = `${provider}:${eventId}`;
  const event = eventStore.get(idempotencyKey);
  
  if (event) {
    event.processed = true;
    event.processedAt = new Date().toISOString();
    eventStore.set(idempotencyKey, event);
  }
}

export function getEventStatus(provider: string, eventId: string): "new" | "processing" | "processed" | "failed" {
  // We use timingSafeEqual for security when comparing event IDs if needed,
  // but since we look up by map key, the map lookup itself is standard.
  // We can simulate constant time lookup against all keys as a strict measure:
  const idempotencyKey = `${provider}:${eventId}`;
  const targetBuffer = Buffer.from(idempotencyKey, "utf8");
  
  let foundEvent: WebhookEvent | undefined;
  
  for (const [key, event] of eventStore.entries()) {
    const keyBuffer = Buffer.from(key, "utf8");
    if (keyBuffer.length === targetBuffer.length && timingSafeEqual(keyBuffer, targetBuffer)) {
      foundEvent = event;
      break;
    }
  }

  if (!foundEvent) {
    return "new";
  }

  // Basic mapping
  if (foundEvent.processed) {
    return "processed";
  }
  
  return "processing";
}

export function cleanupOldEvents(olderThanHours: number): number {
  const now = new Date().getTime();
  const threshold = now - olderThanHours * 3600000;
  let cleaned = 0;

  for (const [key, event] of eventStore.entries()) {
    const receivedAt = new Date(event.receivedAt).getTime();
    if (receivedAt < threshold) {
      eventStore.delete(key);
      cleaned++;
    }
  }

  return cleaned;
}
