// ---------------------------------------------------------------------------
// KYC transition guard — centralizes which kycStatus changes are legitimate.
//
// ADAPTED TO THE ACTUAL MODEL, not the reference report's 7-state ideal. This
// codebase's User has `kycStatus: "unverified" | "pending" | "verified"` and a
// separate `kycTier: 0|1|2|3` (store.ts). setKycStatus() currently accepts ANY
// status→status change, so a bug or a compromised admin path could move a user
// straight to "verified" without ever going through "pending", or silently
// downgrade a "verified" user. This module makes the legal transitions explicit.
//
// It is a PURE function with no side effects and does not yet gate setKycStatus
// (wiring it is a deliberate follow-up — see docs/architecture/KYC_STATE_MACHINE.md —
// because the Stripe webhook and the admin dev path both call setKycStatus and
// must be verified against the table first). Adding the guard here, tested, is the
// safe first half.
// ---------------------------------------------------------------------------

export type KycStatus = "unverified" | "pending" | "verified";

/**
 * Allowed transitions. The value is the set of statuses reachable FROM the key.
 *
 *   unverified → pending            (user starts verification)
 *   pending    → verified           (provider approved)
 *   pending    → unverified         (provider rejected / abandoned — back to start)
 *   verified   → unverified         (revoked / expired — a downgrade, allowed but
 *                                     it is the ONLY way out of verified, so it is
 *                                     explicit and auditable rather than implicit)
 *   verified   → pending            (re-verification required, e.g. document expiry)
 *
 * NOT allowed, and this is the whole point:
 *   unverified → verified           (skips the provider decision entirely)
 */
const ALLOWED: Record<KycStatus, ReadonlySet<KycStatus>> = {
  unverified: new Set<KycStatus>(["pending"]),
  pending: new Set<KycStatus>(["verified", "unverified"]),
  verified: new Set<KycStatus>(["unverified", "pending"]),
};

/** A no-op (from === to) is always fine — idempotent re-application of a status. */
export function canTransitionKyc(from: KycStatus, to: KycStatus): boolean {
  if (from === to) return true;
  return ALLOWED[from]?.has(to) ?? false;
}

export class KycTransitionError extends Error {
  constructor(
    readonly from: KycStatus,
    readonly to: KycStatus
  ) {
    super(
      `Illegal KYC transition: ${from} → ${to}. ` +
        `A user cannot reach "${to}" from "${from}" — verification must pass through "pending".`
    );
    this.name = "KycTransitionError";
  }
}

/** Throws KycTransitionError on an illegal transition; returns void when legal. */
export function assertKycTransition(from: KycStatus, to: KycStatus): void {
  if (!canTransitionKyc(from, to)) throw new KycTransitionError(from, to);
}
