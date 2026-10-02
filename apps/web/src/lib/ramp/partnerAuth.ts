import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { bearerToken, requireApiKey } from "@/lib/apiKeyAuth";
import { parseApiKey } from "@/lib/apiKeys";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getPartnerConfig } from "./partnerConfig";
import type { RampAuth } from "./rampGuard";

// ---------------------------------------------------------------------------
// Who is asking for a ramp session: a signed-in FurlPay user, or a partner
// embedding @furlpay/elements with its publishable key.
//
// PARTNER PATH, in order:
//   1. `Authorization: Bearer pk_…` (or sk_ from a partner's server), resolved
//      through requireApiKey — constant-time secret check, revocation, expiry,
//      environment, IP and Origin allowlists. Production accepts live keys only.
//   2. The key must carry an Origin allowlist. A publishable key is public by
//      design; without an allowlist anyone could open checkouts attributed to
//      the partner from any site.
//   3. Ops must have enabled ramp for the partner (lib/ramp/partnerConfig.ts).
//   4. A per-key budget separate from user limits: quotes 60/min, sessions
//      10/min.
//
// The route-manifest validator admits this function as a principal resolver
// for AUTHENTICATED_USER routes ONLY because partnerAuth.spec pins that it
// calls requireUser and requireApiKey — the same pattern as requireTenant.
// ---------------------------------------------------------------------------

export type RampPurpose = "quote" | "session";

const PARTNER_BUDGET: Record<RampPurpose, { limit: number; windowMs: number }> = {
  quote: { limit: 60, windowMs: 60_000 },
  session: { limit: 10, windowMs: 60_000 },
};

export type RampAuthResult = { ok: true; auth: RampAuth } | { ok: false; res: NextResponse };

/** True when the request presents an API key rather than a user session. */
export function presentsApiKey(req: NextRequest): boolean {
  const token = bearerToken(req);
  return !!token && parseApiKey(token) !== null;
}

async function authenticatePartner(req: NextRequest, purpose: RampPurpose): Promise<RampAuthResult> {
  const key = await requireApiKey(req, {
    scope: "payments:read",
    environment: process.env.NODE_ENV === "production" ? "live" : undefined,
  });
  if (!key.ok) return key;
  const record = key.record;

  if (record.originAllowlist.length === 0) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "origin_allowlist_required", message: "Add your site's origin to this key before using it for ramps." },
        { status: 403 }
      ),
    };
  }

  const cfg = await getPartnerConfig(record.userId);
  if (!cfg.rampEnabled) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "ramp_not_enabled", message: "Ramps are not enabled for this account. Contact FurlPay." },
        { status: 403 }
      ),
    };
  }

  const limited = await rateLimitOr429(req, `ramp.partner.${purpose}`, PARTNER_BUDGET[purpose], record.keyId);
  if (limited) return { ok: false, res: limited };

  return { ok: true, auth: { type: "partner", partnerId: record.userId, keyId: record.keyId, partnerName: record.name } };
}

/**
 * Authenticate a ramp request: an API key if one is presented, otherwise a
 * FurlPay user session. 401 if neither.
 */
export async function authenticateRampRequest(req: NextRequest, purpose: RampPurpose): Promise<RampAuthResult> {
  if (presentsApiKey(req)) return authenticatePartner(req, purpose);
  const user = await requireUser(req);
  if (!user.ok) return user;
  return { ok: true, auth: { type: "user", user: user.account.user, jti: user.claims.jti } };
}

/** For public routes (quotes): a presented key is verified; no credential is allowed. */
export async function optionalRampAuth(req: NextRequest, purpose: RampPurpose): Promise<RampAuthResult | { ok: true; auth: null }> {
  if (presentsApiKey(req)) return authenticatePartner(req, purpose);
  return { ok: true, auth: null };
}
