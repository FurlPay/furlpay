import { kvIncr } from "@/lib/kv";
import { recordSecurityEvent } from "@/lib/ops/events";
import { audit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Volume anomaly detection for privileged customer-data access.
//
// WHAT THIS IS FOR.
//
// Every individual privileged read in this system is authorized, scoped and
// audited. That is necessary and it is not sufficient: the Revolut failure mode
// is not one unauthorized read, it is a legitimate operator — or someone holding
// their credentials — making a hundred authorized ones. Each passes every check.
// The pattern is the signal, and nothing was watching the pattern.
//
// WHAT IT DELIBERATELY IS NOT.
//
// Not surveillance of staff. It counts ACTIONS PER ACTOR PER WINDOW and nothing
// else: no keystrokes, no timing profiles, no behavioural scoring, no per-customer
// tracking of who looked at whom beyond what the audit trail already records for
// its own reasons. The counters hold an actor id and an integer, they expire on
// their own, and they exist to answer one question — "is this a normal amount of
// this activity?"
//
// WHY COUNTERS AND NOT A BASELINE.
//
// A learned baseline needs history this deployment does not have, and a detector
// that trains on its own first week learns that whatever was happening then is
// normal. Fixed thresholds are cruder and honest: a human picked them, they are
// visible in this file, and they can be argued with. Revisit them with real
// traffic rather than inventing a model now.
//
// ALERTING IS NOT IMPLEMENTED HERE, ON PURPOSE.
//
// This raises `OpsSecurityEvent`s at a severity that means something. Routing
// those to a pager is an integration this repository does not have and should not
// fake — see the note on EXTERNAL ALERTING below.
// ---------------------------------------------------------------------------

/**
 * Kinds of privileged access worth counting.
 *
 * Each is an action where one instance is routine and fifty in ten minutes is
 * either an incident or a script.
 */
export type SensitiveAccessKind =
  | "authority_request_staged"
  | "authority_disclosure_redeemed"
  | "authority_disclosure_denied"
  | "customer_lookup"
  | "customer_export"
  | "kyc_access"
  | "statement_download"
  | "role_change";

interface Threshold {
  /** Events in the window before this fires. */
  limit: number;
  windowSeconds: number;
  severity: "low" | "medium" | "high";
  /** What a responder should understand from it. */
  note: string;
}

/**
 * Thresholds, per actor.
 *
 * Tuned to be quiet for real work and loud for extraction. The numbers are
 * deliberately conservative — a false positive costs someone reading an event;
 * a missed one costs a customer dossier — and they are documented so the next
 * person can move them with a reason rather than a guess.
 */
const THRESHOLDS: Record<SensitiveAccessKind, Threshold> = {
  // Staging is the step that BUILDS a dossier. An officer works one case at a
  // time; five in ten minutes is someone working through a list.
  authority_request_staged: {
    limit: 5,
    windowSeconds: 600,
    severity: "high",
    note: "An operator is assembling customer dossiers in bulk.",
  },
  // A successful redemption is the moment data leaves. Three in an hour is more
  // statutory disclosure than this business does in a normal week.
  authority_disclosure_redeemed: {
    limit: 3,
    windowSeconds: 3600,
    severity: "high",
    note: "Unusual volume of completed statutory disclosures.",
  },
  // FAILED redemptions are token guessing. The request id circulates widely; the
  // token does not. Repeated failures against one id is someone probing.
  authority_disclosure_denied: {
    limit: 5,
    windowSeconds: 900,
    severity: "high",
    note: "Repeated disclosure-token failures — probable token probing.",
  },
  customer_lookup: {
    limit: 40,
    windowSeconds: 600,
    severity: "medium",
    note: "High-volume customer lookup by a single operator.",
  },
  customer_export: {
    limit: 5,
    windowSeconds: 3600,
    severity: "high",
    note: "Bulk customer export.",
  },
  kyc_access: {
    limit: 15,
    windowSeconds: 600,
    severity: "high",
    note: "High-volume identity-record access.",
  },
  statement_download: {
    limit: 30,
    windowSeconds: 600,
    severity: "medium",
    note: "High-volume statement retrieval.",
  },
  // Privilege changes are rare by nature. Three in an hour from one admin is
  // either an onboarding day or someone building themselves a quorum.
  role_change: {
    limit: 3,
    windowSeconds: 3600,
    severity: "high",
    note: "Rapid privileged-role changes by a single administrator.",
  },
};

const counterKey = (kind: SensitiveAccessKind, actorId: string) =>
  `anomaly:${kind}:${actorId}`;

/**
 * Record one privileged access and raise an event if the actor is over threshold.
 *
 * NEVER TAKES THE DATA. The signature accepts an actor, a kind and an optional
 * opaque resource reference — deliberately not the customer record, the fields
 * read, or anything from the payload. A detector that logs what it is protecting
 * becomes the easiest place to steal it from, and this one runs on exactly the
 * paths where that would matter most.
 *
 * Fails silently. An anomaly counter that can break a legitimate compliance
 * action by throwing is worse than one that occasionally misses — the counter is
 * a smoke alarm, not a lock, and the locks are elsewhere.
 */
export async function noteSensitiveAccess(params: {
  kind: SensitiveAccessKind;
  actorId: string;
  /** Opaque reference for correlation — a request id, never customer content. */
  resourceRef?: string;
}): Promise<{ count: number; exceeded: boolean } | null> {
  const threshold = THRESHOLDS[params.kind];
  if (!threshold) return null;

  try {
    const count = await kvIncr(counterKey(params.kind, params.actorId), threshold.windowSeconds);

    // Fires ON the crossing only, not on every event after it. A detector that
    // emits once per request past the limit buries the signal it just raised.
    if (count === threshold.limit + 1) {
      await recordSecurityEvent({
        rail: "transfers",
        kind: `anomaly_${params.kind}`,
        severity: threshold.severity,
        detail:
          `${threshold.note} Actor ${params.actorId} performed ${count} ` +
          `'${params.kind}' actions in ${threshold.windowSeconds}s ` +
          `(threshold ${threshold.limit}).`,
        actor: params.actorId,
      });
      audit("ops.security_acknowledged", params.actorId, {
        anomaly: params.kind,
        count,
        windowSeconds: threshold.windowSeconds,
        resourceRef: params.resourceRef,
      });
    }

    return { count, exceeded: count > threshold.limit };
  } catch {
    // Counter store unavailable. Detection degrades; the authorization controls
    // it sits beside do not depend on it.
    return null;
  }
}

/** Exposed for tests and for an ops page that wants to show the policy. */
export function anomalyThresholds(): Readonly<Record<SensitiveAccessKind, Threshold>> {
  return THRESHOLDS;
}

// ---------------------------------------------------------------------------
// EXTERNAL ALERTING — NOT IMPLEMENTED, AND NOT FAKED.
//
// `recordSecurityEvent` persists the event and pushes it onto the ops feed. It
// does not page anyone. Closing that gap needs a destination this repository has
// no credentials for and no way to test against:
//
//   · a paging target (PagerDuty / Opsgenie routing key), or
//   · a webhook to the security channel, or
//   · a SIEM sink
//
// plus an on-call rotation to receive it. Writing a fetch() to a placeholder URL
// would make this file LOOK finished while every alert silently 404s — the
// failure mode where the control appears green and nobody is watching.
//
// So: the event model is complete and the events are real. The last hop is an
// operational decision, and it is listed as an open blocker rather than stubbed.
// ---------------------------------------------------------------------------
