import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { trustedClientCountry } from "@/lib/clientIp";
import { recordVelocityGeo, reserveVelocity } from "@/lib/services/velocity";
import { verifyDestinationAddress, type Chain } from "@/lib/security/addressCheck";
import { checkTransferAmount } from "@/lib/kycTiers";
import { recentStepUp } from "@/lib/stepup";
import type { User } from "@/lib/store";

// ---------------------------------------------------------------------------
// rampGuard — the pre-flight check every ramp route passes before it opens a
// provider order. One function so no route can forget a check.
//
// WHAT IS CHECKED DEPENDS ON WHO MOVES THE MONEY (owner's decision, 2026-10-02):
//
//   | Check                               | hosted            | server-initiated  |
//   |-------------------------------------|-------------------|-------------------|
//   | Signed-in user OR partner key       | required          | required (user)   |
//   | FurlPay KYC (onramp T1, offramp T2) | skipped           | required          |
//   | KYC tier amount limit               | skipped           | required          |
//   | Embargo (trusted platform country)  | always            | always            |
//   | Velocity (reserved atomically)      | always            | always            |
//   | Velocity "review" (volume / geo)    | flagged only      | session step-up   |
//   | Destination address (on-ramp)       | always            | always            |
//   | >= $5,000                           | flagged only      | session step-up   |
//
// HOSTED: the customer pays on the provider's page; the provider is the
// regulated party, runs its own KYC and enhanced checks, and FurlPay never
// holds the funds. A second FurlPay identity gate there added friction and no
// control. SERVER-INITIATED: FurlPay funds the transfer, so FurlPay's own KYC
// and step-up apply — and a partner key (no FurlPay user) cannot use it.
//
// STEP-UP is the existing server-verified, session-bound kind (lib/stepup.ts):
// a fresh OTP or passkey ceremony on THIS session within 15 minutes. A device
// biometric is not accepted — it proves possession of the phone to the phone,
// and nothing about it reaches the server unforgeably.
// ---------------------------------------------------------------------------

/** Countries where FurlPay cannot operate due to sanctions/embargo. */
const EMBARGOED_COUNTRIES = new Set([
  "CU", // Cuba
  "IR", // Iran
  "KP", // North Korea (DPRK)
  "SY", // Syria
  // Crimea / occupied regions of Ukraine need region-level data, which the
  // country header does not carry; Coinbase and Transak enforce them.
  "RU", // Russia (OFAC broad sanctions)
]);

export const STEP_UP_THRESHOLD_USD = 5_000;
export const STEP_UP_WINDOW_MS = 15 * 60_000;

export type RampDirection = "onramp" | "offramp";
export type RampFlowType = "hosted" | "server-initiated";

/** Who is asking. Produced by authenticateRampRequest (lib/ramp/partnerAuth.ts). */
export type RampAuth =
  | { type: "user"; user: User; jti?: string }
  | { type: "partner"; partnerId: string; keyId: string; partnerName: string };

export interface RampGuardInput {
  req: NextRequest;
  auth: RampAuth;
  direction: RampDirection;
  flowType: RampFlowType;
  amountUsd: number;
  /** On-ramp: the wallet the crypto will land in. */
  destinationAddress?: string;
  chain?: Chain;
}

export type RampGuardFlag = "provider_enhanced_verification" | "velocity_review";

export interface RampGuardResult {
  guardId: string;
  velocityFlags: { burst: boolean; dailyVolume: boolean; geoJump: boolean };
  country: string | null;
  flags: RampGuardFlag[];
}

/** The velocity subject: a user, or a partner's whole integration. */
export function rampSubject(auth: RampAuth): string {
  return auth.type === "user" ? auth.user.id : `partner:${auth.partnerId}`;
}

const deny = (status: number, body: Record<string, unknown>) => ({
  pass: false as const,
  response: NextResponse.json(body, { status }),
});

export async function rampGuard(
  input: RampGuardInput
): Promise<{ pass: true; meta: RampGuardResult } | { pass: false; response: NextResponse }> {
  const guardId = randomUUID();
  const serverInitiated = input.flowType === "server-initiated";
  const flags: RampGuardFlag[] = [];

  // Only a platform-set country counts (no Cloudflare fronts FurlPay, so a
  // `cf-ipcountry` header is whatever the client typed). Null = unknown;
  // routes that pick a corridor by country refuse on null.
  const country = trustedClientCountry(input.req);

  if (country && EMBARGOED_COUNTRIES.has(country)) {
    return deny(451, { error: "region_blocked", detail: "This service is not available in your region." });
  }

  // A partner key carries no FurlPay identity to verify, so it cannot drive a
  // transfer FurlPay funds.
  if (serverInitiated && input.auth.type !== "user") {
    return deny(403, { error: "user_required", detail: "This transfer needs a signed-in FurlPay account." });
  }

  if (serverInitiated && input.auth.type === "user") {
    const user = input.auth.user;
    const minTier = input.direction === "onramp" ? 1 : 2;
    const tier = user.kycTier ?? 0;
    if (tier < minTier) {
      return deny(403, {
        error: "kyc_required",
        detail:
          input.direction === "onramp"
            ? "Complete basic verification (Tier 1) to buy crypto."
            : "Complete identity verification (Tier 2) to cash out.",
        requiredTier: minTier,
        currentTier: tier,
      });
    }
    const tierCheck = checkTransferAmount(user.kycTier, input.amountUsd);
    if (!tierCheck.allowed) return deny(403, { error: tierCheck.code, detail: tierCheck.reason });
  }

  // Reserve, not read-then-commit: the counters are incremented atomically
  // first and judged after, so concurrent requests cannot all pass a check
  // none of them has counted yet (lib/services/velocity.ts reserveVelocity).
  const subject = rampSubject(input.auth);
  const velocity = await reserveVelocity({ userId: subject, amountUsd: input.amountUsd, country });
  if (velocity.action === "block") {
    return deny(429, {
      error: "velocity_exceeded",
      detail: "Transaction rate limit exceeded. Please try again later.",
      reasons: velocity.reasons,
    });
  }

  // "review" (daily volume over the cap, or an impossible country change) gets
  // the same treatment as a large amount. It used to fall through unchecked.
  const review = velocity.action === "review";
  if (review && !serverInitiated) flags.push("velocity_review");

  if (input.amountUsd >= STEP_UP_THRESHOLD_USD || (review && serverInitiated)) {
    if (!serverInitiated) {
      // The provider runs its own enhanced verification at this size.
      flags.push("provider_enhanced_verification");
    } else if (input.auth.type === "user") {
      const fresh = await recentStepUp(input.auth.user.id, input.auth.jti, STEP_UP_WINDOW_MS);
      if (!fresh) {
        return deny(401, {
          error: "step_up_required",
          message: review
            ? "This transaction needs additional verification."
            : `Transactions of ${STEP_UP_THRESHOLD_USD.toLocaleString("en-US")} or more require additional verification.`,
          action: { type: "step_up", methods: ["otp", "passkey"] },
        });
      }
    }
  }

  if (input.direction === "onramp" && input.destinationAddress && input.chain) {
    const addr = verifyDestinationAddress(input.destinationAddress, input.chain, []);
    if (!addr.isValid || addr.riskLevel === "critical") {
      return deny(400, { error: "address_rejected", detail: addr.summary, riskFlags: addr.riskFlags });
    }
  }

  return { pass: true, meta: { guardId, velocityFlags: velocity.flags, country, flags } };
}

/**
 * Record that a ramp operation went ahead. The counters were already reserved
 * by rampGuard; this only moves the geo baseline, and only for an order that
 * exists, so a refused attempt from elsewhere cannot shift it.
 */
export async function rampCommit(input: { auth: RampAuth; amountUsd: number; country: string | null }): Promise<void> {
  await recordVelocityGeo(rampSubject(input.auth), input.country);
}
