import { intentDigest, verifyBinding, type CanonicalIntent } from "./canonical";
import { integrityRiskWeight, type AppIntegritySignal } from "./types";

// ---------------------------------------------------------------------------
// The authorization boundary.
//
// THE ARCHITECTURAL POINT, and the reason this file exists rather than two
// separate features: attestation and simulation are ONE control. Bolting on
// "Blockaid" and "Play Integrity" as independent checks leaves the gap between
// them, and the gap is where the attack lives:
//
//     simulate tx A → attest tx A → confirm tx A → sign tx B
//
// Every individual control passes. The wrong transaction is signed. So the
// boundary takes all four commitments and refuses unless they commit to the
// SAME canonical digest.
//
// WHAT CROSSES THIS BOUNDARY. Nothing reaches a signer without:
//
//   1. a canonical intent whose digest the server recomputed itself,
//   2. a simulation keyed on THAT digest, not merely "a simulation",
//   3. an integrity signal bound to THAT digest, or an honest absence,
//   4. a user confirmation recorded against THAT digest,
//   5. and a re-canonicalisation of the payload actually about to be signed.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not hard-fail on a missing
// integrity verdict. Apple's guidance is to onboard App Attest gradually and
// handle unsupported devices; hard-gating blocks old hardware, de-Googled
// Android and enterprise builds — real customers — while an attacker moves to
// whichever platform passes. Integrity RAISES THE BAR through the risk engine;
// the mismatch checks below are what actually block.
//
// The asymmetry is deliberate and worth stating plainly: a MISSING attestation
// is weak evidence and does not block. A MISMATCHED binding is proof that
// something rewrote the transaction, and always blocks.
// ---------------------------------------------------------------------------

export type SimulationOutcome = "clean" | "warning" | "malicious" | "unavailable";

/**
 * A simulation result, bound to the intent it describes.
 *
 * `boundDigest` is not decoration. A simulation that cannot prove which
 * transaction it examined is a simulation of something, and "something" is not
 * what is about to be signed.
 */
export interface SimulationResult {
  readonly outcome: SimulationOutcome;
  readonly boundDigest: string;
  readonly provider: string;
  readonly simulatedAt: string;
  /** Human-readable findings. Never phrased as a safety guarantee. */
  readonly warnings: readonly string[];
  /** Net asset movements the simulation predicts, for the confirmation screen. */
  readonly assetChanges?: readonly {
    readonly assetId: string;
    readonly deltaMinor: string;
    readonly direction: "in" | "out";
  }[];
  /** For approvals: what allowance would be granted, and to whom. */
  readonly approval?: { readonly spender: string; readonly amountMinor: string; readonly unlimited: boolean };
}

/** What the user actually saw and agreed to. */
export interface UserConfirmation {
  readonly boundDigest: string;
  readonly confirmedAt: string;
  /** Step-up method satisfied, when one was required. */
  readonly method?: string;
}

export interface AuthorizationRequest {
  /** The intent the server canonicalised. */
  readonly intent: CanonicalIntent;
  /** Server-issued nonce and account, for binding verification. */
  readonly expected: { readonly nonce: string; readonly accountId: string };
  readonly simulation: SimulationResult | null;
  readonly integrity: AppIntegritySignal | null;
  readonly confirmation: UserConfirmation | null;
  /**
   * Re-canonicalised form of what is ACTUALLY about to be signed.
   *
   * Supplied separately from `intent` on purpose. If the signer path rebuilds
   * the transaction — as it must, since it needs chain-specific encoding —
   * that rebuild is exactly where a substitution can occur. Comparing the two
   * is the last check before the key is used.
   */
  readonly aboutToSign: CanonicalIntent;
  /** Simulation older than this is stale and must be re-run. */
  readonly maxSimulationAgeMs?: number;
}

export type AuthorizationRefusal =
  | "binding_failed"
  | "simulation_missing"
  | "simulation_stale"
  | "simulation_unbound"
  | "simulation_malicious"
  | "confirmation_missing"
  | "confirmation_unbound"
  | "integrity_failed"
  | "integrity_unbound"
  | "signing_payload_mismatch"
  | "expired";

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly refusals: readonly AuthorizationRefusal[];
  /** The digest every control had to agree on. */
  readonly digest: string;
  /** Advisory risk contribution, for the risk engine. Never the decision. */
  readonly riskWeight: number;
  /** Warnings to surface even when allowed. */
  readonly warnings: readonly string[];
  /** Internal explanation. Not customer-facing. */
  readonly explanation: string;
}

/** Default simulation freshness. A minute is long enough for a user to read a
 *  confirmation screen and short enough that chain state has not moved far. */
export const DEFAULT_MAX_SIMULATION_AGE_MS = 90_000;

/**
 * Decide whether a transaction may reach the signer.
 *
 * Collects EVERY refusal rather than short-circuiting. During an incident the
 * difference between "stale simulation" and "signing payload mismatch" is the
 * difference between a slow user and an active attack, and discovering them one
 * request at a time wastes the window in which that distinction is actionable.
 */
export function authorizeForSigning(
  request: AuthorizationRequest,
  now: number = Date.now()
): AuthorizationDecision {
  const refusals: AuthorizationRefusal[] = [];
  const warnings: string[] = [];

  const digest = intentDigest(request.intent);

  // 1. Is the intent itself well-bound, live, and ours?
  const binding = verifyBinding(
    request.intent,
    { digest, nonce: request.expected.nonce, accountId: request.expected.accountId },
    now
  );
  if (!binding.bound) {
    refusals.push(binding.failures.includes("expired") ? "expired" : "binding_failed");
  }

  // 2. THE LAST CHECK BEFORE THE KEY. Whatever the signer path rebuilt must
  //    canonicalise to the same bytes. This is the one that catches the
  //    substitution the whole boundary exists for.
  const signingDigest = intentDigest(request.aboutToSign);
  if (signingDigest !== digest) {
    refusals.push("signing_payload_mismatch");
  }

  // 3. Simulation must exist, be bound to THIS digest, and be fresh.
  const maxAge = request.maxSimulationAgeMs ?? DEFAULT_MAX_SIMULATION_AGE_MS;
  if (!request.simulation) {
    refusals.push("simulation_missing");
  } else {
    if (request.simulation.boundDigest !== digest) {
      // A simulation of a different transaction is not evidence about this one.
      refusals.push("simulation_unbound");
    }
    const simulatedAt = Date.parse(request.simulation.simulatedAt);
    if (!Number.isFinite(simulatedAt) || now - simulatedAt > maxAge) {
      refusals.push("simulation_stale");
    }
    if (request.simulation.outcome === "malicious") {
      refusals.push("simulation_malicious");
    }
    if (request.simulation.outcome === "warning") {
      // Warnings do NOT block. They are surfaced so the user decides, because a
      // simulator that blocks on every warning trains users to route around it.
      warnings.push(...request.simulation.warnings);
    }
    if (request.simulation.outcome === "unavailable") {
      // The provider was down. Not evidence of danger, and not evidence of
      // safety either — so it is a warning, and the risk engine weighs it.
      warnings.push(
        "Transaction simulation was unavailable. This transaction has not been checked for known risks."
      );
    }
    if (request.simulation.approval?.unlimited) {
      warnings.push(
        `Unlimited spending approval for ${request.simulation.approval.spender}. This lets that ` +
          "contract move the full balance, now and in future."
      );
    }
  }

  // 4. Confirmation must be bound to the same digest.
  if (!request.confirmation) {
    refusals.push("confirmation_missing");
  } else if (request.confirmation.boundDigest !== digest) {
    // The user confirmed a different transaction. This is the classic
    // bait-and-switch and it is indistinguishable from a UI bug — both must
    // block.
    refusals.push("confirmation_unbound");
  }

  // 5. Integrity. ASYMMETRIC, and this is the deliberate part:
  //      - absent or unsupported  -> allowed, weighted by the risk engine
  //      - present but MISMATCHED -> blocked, because a token minted for
  //        different content proves something rewrote the request
  let riskWeight = 0;
  if (request.integrity) {
    riskWeight = integrityRiskWeight(request.integrity);

    if (request.integrity.verdict === "failed") {
      if (request.integrity.boundDigest && request.integrity.boundDigest !== digest) {
        refusals.push("integrity_unbound");
      } else {
        // Verification failed for a reason other than binding — a broken Play
        // Services install, an enterprise build. High risk, not a hard block.
        warnings.push("Device integrity could not be verified.");
      }
    } else if (
      request.integrity.verdict === "passed" ||
      request.integrity.verdict === "degraded"
    ) {
      if (!request.integrity.requestBound || request.integrity.boundDigest !== digest) {
        // A PASSING verdict bound to different content is worse than no
        // verdict: it is a valid token being replayed onto another request.
        refusals.push("integrity_unbound");
      }
    }
    if (request.integrity.verdict === "degraded") {
      warnings.push("This device did not meet full integrity checks.");
    }
  } else {
    warnings.push("No device integrity signal was supplied.");
  }

  const allowed = refusals.length === 0;
  return {
    allowed,
    refusals,
    digest,
    riskWeight,
    warnings,
    explanation: allowed
      ? `All controls committed to ${digest.slice(0, 12)}…` +
        (warnings.length ? ` with ${warnings.length} warning(s).` : ".")
      : `Refused: ${refusals.join(", ")}. Controls must all commit to the same canonical intent.`,
  };
}

/**
 * Phrasing for the confirmation screen.
 *
 * NEVER returns "transaction is safe". A clean simulation means no KNOWN issue
 * was detected by one provider against current chain state — it is not a
 * guarantee, and stating it as one transfers our uncertainty onto the user as
 * false confidence, which is the thing they will point at afterwards.
 */
export function simulationSummary(result: SimulationResult | null): string {
  if (!result) return "This transaction has not been simulated.";
  switch (result.outcome) {
    case "clean":
      return "Simulation completed. No known issues were detected.";
    case "warning":
      return `Simulation completed with ${result.warnings.length} warning(s). Review before continuing.`;
    case "malicious":
      return "Simulation detected a known-malicious interaction. This transaction is blocked.";
    case "unavailable":
      return "Simulation was unavailable. This transaction has not been checked.";
  }
}
