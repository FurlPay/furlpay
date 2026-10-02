import { randomUUID } from "crypto";
import { kvSet } from "@/lib/kv";

// ---------------------------------------------------------------------------
// rampAudit — append-only audit trail for every on-ramp and off-ramp
// operation. Every guard invocation, order creation, provider callback, and
// terminal state produces a record. The audit log is the evidence chain for
// chargebacks, compliance inquiries, and fraud investigations.
//
// Storage: Upstash Redis with 7-year TTL (tax/regulatory minimum). Keys are
// prefixed `ramp:audit:` and indexed by both userId and orderId.
// ---------------------------------------------------------------------------

export type RampAuditAction =
  | "guard.passed"
  | "guard.blocked"
  | "onramp.quote.requested"
  | "onramp.session.created"
  | "onramp.checkout.opened"
  | "onramp.completed"
  | "onramp.failed"
  | "offramp.quote.requested"
  | "offramp.session.created"
  | "offramp.executed"
  | "offramp.completed"
  | "offramp.failed"
  | "beneficiary.added"
  | "beneficiary.verified"
  | "beneficiary.changed"
  | "webhook.received"
  | "webhook.rejected"
  | "onramp.status.changed"
  | "offramp.status.changed"
  | "order.created";

export interface RampAuditEntry {
  readonly eventId: string;
  readonly userId: string;
  readonly action: RampAuditAction;
  readonly direction: "onramp" | "offramp";
  readonly timestamp: string;
  readonly amount?: { value: string; currency: string };
  readonly orderId?: string;
  readonly guardId?: string;
  readonly ip?: string;
  readonly country?: string;
  readonly deviceId?: string;
  readonly userAgent?: string;
  readonly biometricUsed?: boolean;
  readonly kycTier?: number;
  readonly velocityFlags?: { burst: boolean; dailyVolume: boolean; geoJump: boolean };
  readonly sanctionsResult?: string;
  readonly addressCheckResult?: string;
  readonly providerSelected?: string;
  readonly providerRef?: string;
  readonly error?: string;
  readonly metadata?: Record<string, unknown>;
}

const SEVEN_YEARS_SECONDS = 7 * 365 * 24 * 3600;

export async function recordRampAudit(entry: Omit<RampAuditEntry, "eventId" | "timestamp">): Promise<string> {
  const eventId = `ramp_evt_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const full: RampAuditEntry = {
    ...entry,
    eventId,
    timestamp: new Date().toISOString(),
  };

  // Write to two indexes: by event and by user (for compliance lookups).
  // Both fail open — audit loss is bad, but blocking a payment because the
  // audit store is down is worse.
  try {
    await Promise.all([
      kvSet(`ramp:audit:${eventId}`, full, SEVEN_YEARS_SECONDS),
      kvSet(
        `ramp:audit:user:${entry.userId}:${eventId}`,
        { eventId, action: entry.action, orderId: entry.orderId, ts: full.timestamp },
        SEVEN_YEARS_SECONDS
      ),
    ]);
  } catch (e) {
    console.error("[rampAudit] write failed (fail-open):", (e as Error).message);
  }
  return eventId;
}
