// ---------------------------------------------------------------------------
// App / device integrity — the platform-attestation boundary.
//
// WHAT THIS IS FOR. `native-app/lib/security/deviceIntegrity.ts` states the
// rule and then names its own gap:
//
//     "Trust is a server's conclusion, not a client's claim."
//     "TODO(backend + native): no Play Integrity provider exists in this app
//      and no route accepts an integrity token."
//
// This is that server side. A local root check is a warning an ordinary user
// heeds and a motivated attacker patches out in minutes. Platform attestation
// is different in kind: the verdict is signed by Apple or Google, not by the
// app, so an attacker who fully controls the device still cannot mint one.
//
// THREE RULES, each of which is a documented platform requirement rather than
// a preference:
//
//   1. THE VERDICT IS VERIFIED SERVER-SIDE. Both platforms return a token to
//      be decoded and checked by a backend. A client that reports "integrity:
//      passed" has reported nothing.
//
//   2. THE VERDICT IS BOUND TO THE REQUEST. Play Integrity carries a
//      `requestHash`; App Attest carries a `clientDataHash`. Both are filled
//      with our intent digest, and the server RECOMPUTES the expected value and
//      compares. An unbound token is a token an attacker can lift from one
//      request and attach to another.
//
//   3. IT IS A SIGNAL, NOT A GATE. Apple's own guidance is to onboard App
//      Attest gradually and handle unsupported devices rather than requiring
//      it absolutely. Hard-failing every device without a perfect verdict
//      blocks old hardware, de-Googled Android, and enterprise builds — real
//      customers — while a determined attacker moves to a platform that passes.
//      So the verdict feeds the risk engine and raises the bar; it does not by
//      itself decide.
//
// NOTHING HERE CONTACTS APPLE OR GOOGLE YET. Both providers report
// `not_configured` until real credentials exist, and `not_configured` is
// explicitly NOT `passed`. See providers/.
// ---------------------------------------------------------------------------

export type IntegrityPlatform = "ios" | "android" | "web";

/**
 * Normalised verdict.
 *
 * `unsupported` and `not_configured` are separate states, and keeping them
 * apart is the difference between "this customer's device cannot do this" and
 * "we have not built this yet". Collapsing either into `failed` would decline
 * real customers for our own gaps; collapsing either into `passed` would be a
 * fabricated security claim.
 */
export type IntegrityVerdict =
  /** Attested and verified against the platform's signature. */
  | "passed"
  /** Verified, but the device or app fell short of the strongest verdict. */
  | "degraded"
  /** Verification ran and the token was invalid, replayed, or unbound. */
  | "failed"
  /** The device or OS version genuinely cannot attest. Not the user's fault. */
  | "unsupported"
  /** We have no credentials or no provider. OUR gap, never the customer's. */
  | "not_configured";

/**
 * One normalised integrity signal.
 *
 * Platform-specific evidence is preserved in `platformDetail` rather than
 * flattened away: "device integrity failed" and "app is not the Play version"
 * are different problems with different responses, and a normalisation that
 * erases the difference makes an analyst's job impossible.
 */
export interface AppIntegritySignal {
  readonly platform: IntegrityPlatform;
  readonly verdict: IntegrityVerdict;
  /** The bundle/package the token was actually issued for. */
  readonly appId?: string;
  readonly appVersion?: string;
  /** True only when the token's request binding matched OUR recomputed digest. */
  readonly requestBound: boolean;
  /** Digest the token committed to, for audit. */
  readonly boundDigest?: string;
  /** ms since the token was issued; staleness is its own attack surface. */
  readonly attestationAgeMs?: number;
  readonly verifiedAt: string;
  /** Why it is not `passed`. Internal wording — never shown to a customer. */
  readonly failureReason?: string;
  /**
   * Raw platform verdict fields, redacted.
   *
   * Kept because collapsing them loses the analyst's evidence, and bounded
   * because retaining raw attestation material indefinitely is a data
   * obligation we should not take on without a reason.
   */
  readonly platformDetail?: Readonly<Record<string, string | number | boolean>>;
}

/** What the caller hands a provider for verification. */
export interface IntegrityVerificationRequest {
  readonly platform: IntegrityPlatform;
  /** Opaque platform token: an integrity token, or an assertion. */
  readonly token: string;
  /**
   * The digest the server INDEPENDENTLY computed for this request.
   *
   * Never taken from the client. The whole value of request binding is that
   * both sides derive it separately and compare; accepting the client's copy
   * would verify the token against whatever the attacker wanted it to say.
   */
  readonly expectedDigest: string;
  /** Server-issued challenge, for platforms that carry one. */
  readonly challenge?: string;
  /** Stable per-installation key id, for assertion counter tracking. */
  readonly keyId?: string;
}

export class IntegrityVerificationError extends Error {
  readonly verdict: IntegrityVerdict;
  constructor(verdict: IntegrityVerdict, message: string) {
    super(message);
    this.name = "IntegrityVerificationError";
    this.verdict = verdict;
  }
}

export interface AppIntegrityProvider {
  readonly platform: IntegrityPlatform;
  /** False when credentials are absent. Callers must not treat this as a pass. */
  isConfigured(): boolean;
  verify(request: IntegrityVerificationRequest): Promise<AppIntegritySignal>;
}

/**
 * Assertion replay state.
 *
 * App Attest assertions carry a counter that MUST increase. A counter that
 * repeats or goes backwards means the assertion was replayed or the key was
 * cloned, and it is the only mechanism that catches an attacker who captured a
 * valid assertion and is re-presenting it.
 *
 * An interface rather than an implementation because the store must be durable
 * and shared: an in-memory counter on serverless is per-instance, so a replay
 * simply lands on a different lambda and succeeds.
 */
export interface AssertionCounterStore {
  /** Highest counter seen for this key, or null if never seen. */
  get(keyId: string): Promise<number | null>;
  /**
   * Record a counter, but only if it is strictly greater.
   *
   * Returns false when the counter did not advance — which the caller must
   * treat as a replay. The compare-and-set has to be atomic; doing it as a
   * read then a write leaves a window in which two concurrent replays both
   * observe the old value and both pass.
   */
  advance(keyId: string, counter: number): Promise<boolean>;
}

/**
 * How much an integrity verdict should move the risk needle.
 *
 * Returned as an advisory weight rather than a decision, because the decision
 * belongs to the risk engine where it can be weighed against everything else.
 *
 * `not_configured` returns 0 deliberately. Our own missing integration must
 * never add risk to a customer's score — that would penalise every user of a
 * platform we have not finished building for.
 */
export function integrityRiskWeight(signal: AppIntegritySignal): number {
  switch (signal.verdict) {
    case "passed":
      // Slightly trust-building, and only slightly. A passing verdict proves
      // the app is genuine; it says nothing about whether the person holding
      // the phone is the account holder.
      return signal.requestBound ? -0.1 : 0;
    case "degraded":
      return 0.3;
    case "failed":
      // High but not decisive. Attestation fails for real reasons — a
      // sideloaded build from a legitimate enterprise deployment, a device
      // whose Play Services are broken.
      return 0.6;
    case "unsupported":
      // The customer's device genuinely cannot attest. Not their fault and
      // barely evidence of anything.
      return 0.05;
    case "not_configured":
      return 0;
  }
}
