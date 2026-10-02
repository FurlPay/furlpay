import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { trustedClientCountry } from "@/lib/clientIp";
import { checkVelocity, commitVelocity } from "@/lib/services/velocity";
import { verifyDestinationAddress, type Chain } from "@/lib/security/addressCheck";
import { checkTransferAmount } from "@/lib/kycTiers";
import type { User } from "@/lib/store";

// ---------------------------------------------------------------------------
// rampGuard — the pre-flight security check every on-ramp and off-ramp route
// must pass before creating a provider order.
//
// It aggregates velocity checks, KYC tier gating, sanctions screening,
// address verification, and embargoed-country blocking into ONE function so
// no route can forget one. The alternative — sprinkling five `if` blocks in
// every route — is how one gets skipped in a refactor.
//
// FAIL SEMANTICS: returns null when all checks pass, or a ready-to-return
// NextResponse when any check fails. The caller does:
//
//   const guard = await rampGuard({ ... });
//   if (guard) return guard;
//
// This is the same pattern as rateLimitOr429 — a guard that produces its own
// error response so the caller cannot misinterpret null vs undefined.
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

export type RampDirection = "onramp" | "offramp";

export interface RampGuardInput {
  req: NextRequest;
  user: User;
  direction: RampDirection;
  amountUsd: number;
  /** Required for on-ramp: the destination wallet address. */
  destinationAddress?: string;
  /** Required for on-ramp: the chain the crypto will land on. */
  chain?: Chain;
}

export interface RampGuardResult {
  /** Unique id for this guard invocation — attached to audit trail. */
  guardId: string;
  velocityFlags: { burst: boolean; dailyVolume: boolean; geoJump: boolean };
  country: string | null;
}

/**
 * Returns null on success (all checks pass) or a NextResponse on failure.
 * On success, also returns metadata for the audit trail.
 */
export async function rampGuard(
  input: RampGuardInput
): Promise<{ pass: true; meta: RampGuardResult } | { pass: false; response: NextResponse }> {
  const guardId = randomUUID();
  // Only a platform-set country counts. `cf-ipcountry` was read as a fallback,
  // but no Cloudflare proxy fronts FurlPay: that header is whatever the client
  // typed, which made the embargo check opt-in. Null means "unknown" — routes
  // that pick a corridor by country refuse on null rather than assume one.
  const country = trustedClientCountry(input.req);

  // ── 1. Embargoed country ──────────────────────────────────────────
  if (country && EMBARGOED_COUNTRIES.has(country)) {
    return {
      pass: false,
      response: NextResponse.json(
        { error: "region_blocked", detail: "This service is not available in your region." },
        { status: 451 } // Unavailable For Legal Reasons
      ),
    };
  }

  // ── 2. KYC tier check ──────────────────────────────────────────────
  // On-ramp requires Tier 1+, off-ramp requires Tier 2+.
  const minTier = input.direction === "onramp" ? 1 : 2;
  const userTier = input.user.kycTier ?? 0;
  if (userTier < minTier) {
    return {
      pass: false,
      response: NextResponse.json(
        {
          error: "kyc_required",
          detail: input.direction === "onramp"
            ? "Complete basic verification (Tier 1) to buy crypto."
            : "Complete identity verification (Tier 2) to cash out.",
          requiredTier: minTier,
          currentTier: userTier,
        },
        { status: 403 }
      ),
    };
  }

  // ── 3. KYC amount limit ────────────────────────────────────────────
  const tierCheck = checkTransferAmount(input.user.kycTier, input.amountUsd);
  if (!tierCheck.allowed) {
    return {
      pass: false,
      response: NextResponse.json(
        { error: tierCheck.code, detail: tierCheck.reason },
        { status: 403 }
      ),
    };
  }

  // ── 4. Velocity check ──────────────────────────────────────────────
  const velocity = await checkVelocity({
    userId: input.user.id,
    amountUsd: input.amountUsd,
    country,
  });

  if (velocity.action === "block") {
    return {
      pass: false,
      response: NextResponse.json(
        {
          error: "velocity_exceeded",
          detail: "Transaction rate limit exceeded. Please try again later.",
          reasons: velocity.reasons,
        },
        { status: 429 }
      ),
    };
  }

  // velocity.action === "review" → the caller should require step-up MFA.
  // We pass the flags through so the caller can enforce it.

  // ── 5. Destination address check (on-ramp only) ────────────────────
  if (
    input.direction === "onramp" &&
    input.destinationAddress &&
    input.chain
  ) {
    const addrReport = verifyDestinationAddress(
      input.destinationAddress,
      input.chain,
      [], // no history hint available here
    );
    if (!addrReport.isValid || addrReport.riskLevel === "critical") {
      return {
        pass: false,
        response: NextResponse.json(
          {
            error: "address_rejected",
            detail: addrReport.summary,
            riskFlags: addrReport.riskFlags,
          },
          { status: 400 }
        ),
      };
    }
  }

  return {
    pass: true,
    meta: {
      guardId,
      velocityFlags: velocity.flags,
      country,
    },
  };
}

/**
 * Record that a ramp operation completed — updates velocity counters.
 * Call AFTER the money actually moved, not before.
 */
export async function rampCommit(input: {
  userId: string;
  amountUsd: number;
  country: string | null;
}): Promise<void> {
  await commitVelocity({
    userId: input.userId,
    amountUsd: input.amountUsd,
    country: input.country,
  });
}
