import { kvGet, kvSetNx, kvSet } from "@/lib/kv";
import {
  integrityRiskWeight,
  type AppIntegrityProvider,
  type AppIntegritySignal,
  type AssertionCounterStore,
  type IntegrityVerificationRequest,
} from "./types";

// ---------------------------------------------------------------------------
// Platform providers.
//
// WHAT IS IMPLEMENTED HERE: the verification ORDER, the request binding, the
// replay defences, and the refusals. Those are the parts that are ours to get
// right, and the parts an attacker probes.
//
// WHAT IS NOT: the calls to Apple's attestation service and Google's Play
// Integrity decode endpoint. Both need credentials this deployment does not
// have — an Apple team id and App Attest environment, a Google Cloud service
// account with the Play Integrity API enabled. Writing a client that "works"
// against an unconfigured service would produce a `passed` verdict from a
// function that contacted nobody, which is the precise failure this codebase
// keeps removing.
//
// So both providers return `not_configured` until credentials exist, and
// `not_configured` is explicitly NOT `passed` — `integrityRiskWeight` scores it
// zero rather than negative, and the boundary treats it as "no evidence".
//
// The steps below run in an order chosen so the CHEAPEST refusals happen first
// and nothing touches an upstream until the request is worth spending a call
// on. That is not only performance: an endpoint that calls Apple before
// checking its own inputs is an amplification vector.
// ---------------------------------------------------------------------------

/** Maximum age of an attestation token before it is stale. */
export const MAX_TOKEN_AGE_MS = 5 * 60_000;

// ── Assertion counter store ────────────────────────────────────────────────

const COUNTER_KEY = (keyId: string) => `attest:counter:${keyId}`;
const COUNTER_TTL_SECONDS = 400 * 86_400;

/**
 * Durable counter store on the KV layer.
 *
 * MUST be durable and shared. An in-memory counter on serverless is
 * per-instance, so a replayed assertion simply lands on a different lambda and
 * passes — which defeats the only control that catches a captured assertion
 * being re-presented.
 */
export const kvAssertionCounters: AssertionCounterStore = {
  async get(keyId) {
    const value = await kvGet<number>(COUNTER_KEY(keyId));
    return typeof value === "number" ? value : null;
  },
  async advance(keyId, counter) {
    if (!Number.isInteger(counter) || counter < 0) return false;
    const key = COUNTER_KEY(keyId);

    // First sighting: claim it atomically. SET NX is what stops two concurrent
    // first-assertions from both succeeding.
    const claimed = await kvSetNx(key, counter, COUNTER_TTL_SECONDS);
    if (claimed) return true;

    const current = await kvGet<number>(key);
    if (typeof current !== "number") return false;
    // Strictly greater. Equal is a replay, not a retry.
    if (counter <= current) return false;

    await kvSet(key, counter, COUNTER_TTL_SECONDS);
    return true;
  },
};

function baseSignal(
  platform: AppIntegritySignal["platform"],
  verdict: AppIntegritySignal["verdict"],
  failureReason?: string
): AppIntegritySignal {
  return {
    platform,
    verdict,
    requestBound: false,
    verifiedAt: new Date().toISOString(),
    failureReason,
  };
}

// ── Apple App Attest ───────────────────────────────────────────────────────

/**
 * Apple App Attest.
 *
 * The documented flow is generateKey → attestKey(clientDataHash) →
 * generateAssertion(clientDataHash), where the server verifies the attestation
 * object, checks that the challenge matches what it issued, and — for every
 * subsequent assertion — that the counter has INCREASED.
 *
 * `clientDataHash` is filled with our intent digest, so the assertion commits
 * to the exact transaction rather than merely to "some request from this app".
 */
export class AppleAppAttestProvider implements AppIntegrityProvider {
  readonly platform = "ios" as const;

  constructor(private readonly counters: AssertionCounterStore = kvAssertionCounters) {}

  isConfigured(): boolean {
    return Boolean(
      process.env.APPLE_TEAM_ID &&
        process.env.APPLE_APP_ATTEST_BUNDLE_ID &&
        process.env.APPLE_APP_ATTEST_ENVIRONMENT
    );
  }

  async verify(request: IntegrityVerificationRequest): Promise<AppIntegritySignal> {
    if (!this.isConfigured()) {
      return baseSignal(
        "ios",
        "not_configured",
        "App Attest is not configured (APPLE_TEAM_ID, APPLE_APP_ATTEST_BUNDLE_ID, " +
          "APPLE_APP_ATTEST_ENVIRONMENT). No verification was performed."
      );
    }

    // Input checks before anything expensive. A malformed token must not cost
    // an upstream call, or this endpoint becomes an amplifier.
    if (!request.token || request.token.length > 16_384) {
      return baseSignal("ios", "failed", "Assertion missing or implausibly large.");
    }
    if (!request.keyId) {
      // Without a key id there is no counter to check, so replay protection is
      // absent — and an assertion with no replay protection is not evidence.
      return baseSignal("ios", "failed", "Assertion presented without a key id; replay cannot be excluded.");
    }
    if (!/^[0-9a-f]{64}$/.test(request.expectedDigest)) {
      return baseSignal("ios", "failed", "Server-side expected digest is malformed.");
    }

    // NOT IMPLEMENTED: the cryptographic verification of the attestation
    // object and assertion signature against Apple's root, and the nonce/
    // clientDataHash comparison inside the signed authenticator data.
    //
    // Doing the counter advance here anyway would be worse than useless: it
    // would burn the counter for a token nobody verified, so a later real
    // implementation would reject the genuine follow-up assertion.
    return baseSignal(
      "ios",
      "not_configured",
      "App Attest credentials are present but signature verification against Apple's root is not " +
        "implemented. Refusing to report a verdict that was not actually checked."
    );
  }

  /**
   * Counter check, exposed so it can be exercised independently of Apple.
   *
   * The counter is the whole of App Attest's replay defence: a captured
   * assertion re-presented later carries a counter that no longer advances.
   */
  async checkCounter(keyId: string, counter: number): Promise<boolean> {
    return this.counters.advance(keyId, counter);
  }
}

// ── Android Play Integrity ─────────────────────────────────────────────────

/** Verdict strings Google returns. Kept as a union so a new value is visible. */
export type PlayDeviceRecognition =
  | "MEETS_DEVICE_INTEGRITY"
  | "MEETS_BASIC_INTEGRITY"
  | "MEETS_STRONG_INTEGRITY"
  | "MEETS_VIRTUAL_INTEGRITY";

export interface PlayIntegrityPayload {
  readonly requestDetails?: {
    readonly requestPackageName?: string;
    readonly requestHash?: string;
    readonly timestampMillis?: string;
  };
  readonly appIntegrity?: {
    readonly appRecognitionVerdict?: string;
    readonly packageName?: string;
    readonly versionCode?: string;
  };
  readonly deviceIntegrity?: {
    readonly deviceRecognitionVerdict?: readonly string[];
  };
  readonly accountDetails?: { readonly appLicensingVerdict?: string };
  readonly environmentDetails?: {
    readonly playProtectVerdict?: string;
    readonly appAccessRiskVerdict?: { readonly appsDetected?: readonly string[] };
  };
}

/**
 * Google Play Integrity.
 *
 * The documented backend duty is to decode the token, then check
 * `requestDetails` BEFORE evaluating trustworthiness: recompute the request
 * digest independently and compare it with the returned `requestHash`, confirm
 * the package name, and check freshness. Only then do the verdicts mean
 * anything, because an unbound token is one an attacker lifted from a
 * different request.
 */
export class AndroidPlayIntegrityProvider implements AppIntegrityProvider {
  readonly platform = "android" as const;

  isConfigured(): boolean {
    return Boolean(
      process.env.ANDROID_PACKAGE_NAME && process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT
    );
  }

  async verify(request: IntegrityVerificationRequest): Promise<AppIntegritySignal> {
    if (!this.isConfigured()) {
      return baseSignal(
        "android",
        "not_configured",
        "Play Integrity is not configured (ANDROID_PACKAGE_NAME, PLAY_INTEGRITY_SERVICE_ACCOUNT). " +
          "No verification was performed."
      );
    }
    if (!request.token || request.token.length > 32_768) {
      return baseSignal("android", "failed", "Integrity token missing or implausibly large.");
    }
    if (!/^[0-9a-f]{64}$/.test(request.expectedDigest)) {
      return baseSignal("android", "failed", "Server-side expected digest is malformed.");
    }

    // NOT IMPLEMENTED: the decode call to Google's Play Integrity endpoint,
    // which requires a service-account credential. `evaluatePayload` below
    // holds every check that follows the decode and is fully implemented and
    // tested — so the day the credential exists, this method decodes and hands
    // the payload straight to it.
    return baseSignal(
      "android",
      "not_configured",
      "Play Integrity credentials are present but the token decode against Google is not " +
        "implemented. Refusing to report a verdict that was not actually checked."
    );
  }

  /**
   * Evaluate a DECODED payload.
   *
   * Separated from the network call on purpose: this is the part that is ours
   * to get right, and it is fully testable without contacting Google.
   *
   * Order matters and follows the platform guidance — bind first, then judge.
   * A token that passes every integrity verdict but was minted for a different
   * request tells us nothing about THIS request.
   */
  evaluatePayload(
    payload: PlayIntegrityPayload,
    expected: { digest: string; packageName: string },
    now: number = Date.now()
  ): AppIntegritySignal {
    const detail: Record<string, string | number | boolean> = {};
    const at = new Date(now).toISOString();

    const pkg = payload.requestDetails?.requestPackageName ?? payload.appIntegrity?.packageName;
    if (pkg !== expected.packageName) {
      // A token for a different package is a token from a different app. It may
      // be perfectly valid and is not evidence about ours.
      return {
        platform: "android",
        verdict: "failed",
        requestBound: false,
        verifiedAt: at,
        failureReason: `Token was issued for package "${pkg}", expected "${expected.packageName}".`,
        platformDetail: { observedPackage: String(pkg ?? "") },
      };
    }

    // THE BINDING CHECK. The expected digest is recomputed by the server; this
    // compares the token's commitment against it. Without this the token can be
    // lifted from a $1 request and attached to a $10,000 one.
    const returnedHash = payload.requestDetails?.requestHash ?? "";
    const bound = returnedHash === expected.digest;
    if (!bound) {
      return {
        platform: "android",
        verdict: "failed",
        requestBound: false,
        boundDigest: returnedHash || undefined,
        verifiedAt: at,
        failureReason:
          "requestHash does not match the digest the server computed for this request. The token " +
          "was minted for different content.",
      };
    }

    // Freshness. Replay is handled by Play for standard requests, but a stale
    // token still describes a device state that may no longer hold.
    const issuedAt = Number(payload.requestDetails?.timestampMillis ?? NaN);
    let ageMs: number | undefined;
    if (Number.isFinite(issuedAt)) {
      ageMs = now - issuedAt;
      if (ageMs > MAX_TOKEN_AGE_MS) {
        return {
          platform: "android",
          verdict: "failed",
          requestBound: true,
          boundDigest: returnedHash,
          attestationAgeMs: ageMs,
          verifiedAt: at,
          failureReason: `Token is ${Math.round(ageMs / 1000)}s old, beyond the ${MAX_TOKEN_AGE_MS / 1000}s window.`,
        };
      }
    }

    const deviceVerdicts = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
    const appVerdict = payload.appIntegrity?.appRecognitionVerdict ?? "UNEVALUATED";
    detail.appRecognitionVerdict = appVerdict;
    detail.deviceVerdicts = deviceVerdicts.join(",");
    if (payload.environmentDetails?.playProtectVerdict) {
      detail.playProtectVerdict = payload.environmentDetails.playProtectVerdict;
    }
    const riskApps = payload.environmentDetails?.appAccessRiskVerdict?.appsDetected ?? [];
    if (riskApps.length > 0) detail.appAccessRisk = riskApps.join(",");

    // An empty verdict array means the device met NO integrity bar — the
    // signature is still Google's, so this is a real verdict, not an absence.
    if (deviceVerdicts.length === 0) {
      return {
        platform: "android",
        verdict: "failed",
        requestBound: true,
        boundDigest: returnedHash,
        attestationAgeMs: ageMs,
        appId: pkg,
        appVersion: payload.appIntegrity?.versionCode,
        verifiedAt: at,
        failureReason: "Device met no integrity verdict.",
        platformDetail: detail,
      };
    }

    // A virtual-only device is an emulator. Reported as degraded rather than
    // failed: CI, QA and accessibility tooling all run in emulators, and the
    // risk engine is the right place to decide what that is worth in context.
    const virtualOnly =
      deviceVerdicts.includes("MEETS_VIRTUAL_INTEGRITY") &&
      !deviceVerdicts.includes("MEETS_DEVICE_INTEGRITY");

    const unrecognisedApp = appVerdict !== "PLAY_RECOGNIZED";
    const weakDevice = !deviceVerdicts.includes("MEETS_DEVICE_INTEGRITY");
    const riskAppsPresent = riskApps.length > 0;

    const degraded = virtualOnly || unrecognisedApp || weakDevice || riskAppsPresent;

    return {
      platform: "android",
      verdict: degraded ? "degraded" : "passed",
      requestBound: true,
      boundDigest: returnedHash,
      attestationAgeMs: ageMs,
      appId: pkg,
      appVersion: payload.appIntegrity?.versionCode,
      verifiedAt: at,
      failureReason: degraded
        ? [
            virtualOnly && "virtual device",
            unrecognisedApp && `app verdict ${appVerdict}`,
            weakDevice && "device integrity not met",
            riskAppsPresent && "screen-capture or overlay apps active",
          ]
            .filter(Boolean)
            .join("; ")
        : undefined,
      platformDetail: detail,
    };
  }
}

// ── Resolution ─────────────────────────────────────────────────────────────

const apple = new AppleAppAttestProvider();
const android = new AndroidPlayIntegrityProvider();

export function integrityProviderFor(
  platform: AppIntegritySignal["platform"]
): AppIntegrityProvider | null {
  if (platform === "ios") return apple;
  if (platform === "android") return android;
  // Web has no platform attestation. Saying so is better than pretending a
  // browser signal is equivalent — it is not, and treating it as such would
  // make the web the obvious path for anyone the mobile controls stopped.
  return null;
}

/**
 * Verify, or return the honest "no provider" signal.
 *
 * Never throws. An integrity check that fails with an exception takes down the
 * money path it was meant to protect, which converts a security control into
 * an availability incident.
 */
export async function verifyIntegrity(
  request: IntegrityVerificationRequest
): Promise<AppIntegritySignal> {
  const provider = integrityProviderFor(request.platform);
  if (!provider) {
    return baseSignal(
      request.platform,
      "unsupported",
      `No platform attestation exists for ${request.platform}.`
    );
  }
  try {
    return await provider.verify(request);
  } catch (e) {
    return baseSignal(request.platform, "failed", `Verification error: ${(e as Error).message}`);
  }
}

export { integrityRiskWeight };
