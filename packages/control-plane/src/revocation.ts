// ---------------------------------------------------------------------------
// The Live Revocation State Engine.
//
// THE GAP THIS CLOSES, stated as precisely as it deserves: a signature is a
// statement about a moment, and it keeps being true. A mandate signed at 09:00
// valid for 24 hours is still cryptographically valid at 11:00 — after the
// project was cancelled, after the employee was deprovisioned in the IdP, after
// the agent was killed, after the wallet was found to be compromised. Anything
// that verifies only the signature will honour it. That is not a bug in the
// signature; it is the absence of a second question.
//
// This module is the second question: IS THIS AUTHORITY STILL LIVE, RIGHT NOW.
//
// THREE PROPERTIES IT HAS TO HAVE, AND WHY EACH ONE MATTERS.
//
//   1. CASCADE. Revoking a principal must kill every delegation, agent, session
//      and mandate beneath it. If revocation were per-record, deprovisioning a
//      human would leave their agents spending, and an operator would have to
//      enumerate descendants correctly under time pressure during an incident.
//      Subjects are therefore checked as a SET — every id in the resolved chain
//      plus the mandate and credential — and any one of them being revoked ends
//      it. A caller cannot forget an ancestor because the ancestors are the
//      input.
//
//   2. FAIL CLOSED, INCLUDING ON STALENESS. "The revocation store did not
//      answer" and "nothing is revoked" are different facts, and a system that
//      confuses them converts a Redis outage into an authorization bypass. So a
//      failed lookup is DENY, and — this is the part usually missed — a
//      snapshot older than `maxStalenessMs` is also DENY. A cache that is
//      allowed to serve indefinitely when the source is unreachable has exactly
//      the same failure as reading nothing at all, only slower.
//
//   3. NO POSITIVE CACHING OF "NOT REVOKED" BEYOND THE WINDOW. The staleness
//      bound is the entire value of the word "live" in the name. Without it this
//      is a revocation list, not a revocation engine.
//
// EMERGENCY KILL SWITCH. One flag that denies everything in scope, evaluated
// FIRST so no other condition can mask it. Its reason is carried through to the
// denial body because an operator who pulled the switch needs the agents they
// stopped to say why they stopped.
//
// PURE. The lookup is performed by the caller and handed in. That keeps every
// branch — including both failure modes, which are the ones that matter —
// testable without a network.
// ---------------------------------------------------------------------------

/** Kinds of subject the engine can be asked about. Recorded per entry so a
 *  denial can name WHAT was revoked, not just that something was. */
export type RevocationSubjectKind =
  | "organization"
  | "principal"
  | "delegation"
  | "operator"
  | "agent"
  | "session"
  | "mandate"
  | "credential"
  | "recipient";

export interface RevocationSubject {
  readonly kind: RevocationSubjectKind;
  readonly id: string;
}

export interface RevocationEntry {
  readonly kind: RevocationSubjectKind;
  readonly id: string;
  readonly revokedAt: string;
  readonly reason: string;
  /** Who pulled it. "system" for automated revocation. */
  readonly revokedBy: string;
}

export interface KillSwitchState {
  readonly engaged: boolean;
  /** "global" stops every organization; "organization" stops one. */
  readonly scope: "global" | "organization";
  readonly organizationId?: string;
  readonly reason?: string;
  readonly engagedAt?: string;
  readonly engagedBy?: string;
}

/**
 * A point-in-time view of revocation state.
 *
 * `fetchedAtMs` is the observation time of the SOURCE, not of the cache read.
 * Passing the cache-read time would defeat the staleness bound entirely, so the
 * adapter must stamp it when the data left the store.
 */
export interface RevocationSnapshot {
  readonly killSwitch: KillSwitchState;
  readonly entries: readonly RevocationEntry[];
  readonly fetchedAtMs: number;
}

export type RevocationLookup =
  | { readonly ok: true; readonly snapshot: RevocationSnapshot }
  /** The store could not be read. This is a DENY, never an ALLOW. */
  | { readonly ok: false; readonly error: string };

export type RevocationVerdict =
  | { readonly live: true; readonly checkedSubjects: number; readonly snapshotAgeMs: number }
  | {
      readonly live: false;
      readonly reason:
        | "kill_switch_engaged"
        | "subject_revoked"
        | "state_unavailable"
        | "state_stale";
      readonly detail: string;
      /** Present when a specific subject was the cause. */
      readonly subject?: RevocationSubject;
      readonly revokedAt?: string;
    };

export interface EvaluateRevocationInput {
  readonly lookup: RevocationLookup;
  /** Every link whose revocation must end this operation. */
  readonly subjects: readonly RevocationSubject[];
  readonly organizationId: string;
  readonly nowMs: number;
  /**
   * How old a snapshot may be and still be trusted.
   *
   * This is the tightest knob in the system and it is a trade, stated plainly:
   * smaller means a revocation propagates faster and the store is read more
   * often; larger means an outage is survived for longer and a revoked agent
   * keeps spending for up to that long. The default is deliberately short.
   */
  readonly maxStalenessMs: number;
}

/** 5 seconds. A revoked mandate stays spendable for at most this long. */
export const DEFAULT_MAX_STALENESS_MS = 5_000;

/**
 * Decide whether the presented authority is still live.
 *
 * Order: availability, then staleness, then kill switch, then subjects. The
 * first two come before the kill switch because a snapshot we cannot trust
 * cannot be trusted to tell us the switch is OFF either.
 */
export function evaluateRevocation(input: EvaluateRevocationInput): RevocationVerdict {
  if (!input.lookup.ok) {
    return {
      live: false,
      reason: "state_unavailable",
      detail:
        `revocation state could not be read (${input.lookup.error}); denying because a ` +
        `signature that verifies is not evidence that the authority behind it still exists`,
    };
  }

  const snapshot = input.lookup.snapshot;
  const ageMs = input.nowMs - snapshot.fetchedAtMs;
  // A snapshot from the future is a clock problem, not freshness. Treat the
  // absolute skew: a large negative age means the two clocks disagree, and
  // trusting the reading would silently extend the staleness window.
  if (ageMs > input.maxStalenessMs || ageMs < -input.maxStalenessMs) {
    return {
      live: false,
      reason: "state_stale",
      detail:
        `revocation snapshot is ${ageMs}ms old against a ${input.maxStalenessMs}ms bound; ` +
        `serving a stale "nothing is revoked" is the same failure as not checking at all`,
    };
  }

  const ks = snapshot.killSwitch;
  if (
    ks.engaged &&
    (ks.scope === "global" || (ks.scope === "organization" && ks.organizationId === input.organizationId))
  ) {
    return {
      live: false,
      reason: "kill_switch_engaged",
      detail: ks.reason
        ? `${ks.scope} kill switch engaged: ${ks.reason}`
        : `${ks.scope} kill switch engaged`,
    };
  }

  // Index by "kind:id" rather than by id alone: two different kinds legitimately
  // share an id namespace in some deployments, and matching on the bare id
  // would revoke an agent because a mandate with the same suffix was revoked.
  const index = new Map<string, RevocationEntry>();
  for (const entry of snapshot.entries) index.set(`${entry.kind}:${entry.id}`, entry);

  for (const subject of input.subjects) {
    const hit = index.get(`${subject.kind}:${subject.id}`);
    if (hit) {
      return {
        live: false,
        reason: "subject_revoked",
        detail: `${subject.kind} ${subject.id} was revoked: ${hit.reason}`,
        subject,
        revokedAt: hit.revokedAt,
      };
    }
  }

  return { live: true, checkedSubjects: input.subjects.length, snapshotAgeMs: ageMs };
}

/**
 * Build the subject list for a payment from its resolved chain.
 *
 * Exists so no call site assembles this by hand. A caller that forgot to
 * include the delegation would have a revoked delegation still authorizing
 * payments, and that omission is invisible in review — it looks like a shorter
 * list, not like a missing control.
 */
export function subjectsForPayment(input: {
  readonly organizationId: string;
  readonly principalId: string;
  readonly delegationId: string;
  readonly operatorId: string;
  readonly agentId: string;
  readonly sessionId?: string;
  readonly mandateId: string;
  readonly credentialId?: string;
  readonly recipientId?: string;
}): readonly RevocationSubject[] {
  const subjects: RevocationSubject[] = [
    { kind: "organization", id: input.organizationId },
    { kind: "principal", id: input.principalId },
    { kind: "delegation", id: input.delegationId },
    { kind: "operator", id: input.operatorId },
    { kind: "agent", id: input.agentId },
    { kind: "mandate", id: input.mandateId },
  ];
  if (input.sessionId) subjects.push({ kind: "session", id: input.sessionId });
  if (input.credentialId) subjects.push({ kind: "credential", id: input.credentialId });
  if (input.recipientId) subjects.push({ kind: "recipient", id: input.recipientId });
  return subjects;
}
