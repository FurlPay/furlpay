import { NextRequest, NextResponse } from "next/server";
import { trustedClientIp } from "@/lib/clientIp";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { OfframpSessionSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/authz";
import { coinbaseOfframpUrl, coinbaseRampBackend, isCoinbaseRampChain } from "@/lib/services/coinbaseRamp";
import { rampGuard, rampCommit } from "@/lib/ramp/rampGuard";
import { recordRampAudit } from "@/lib/ramp/rampAudit";
import type { Chain } from "@/lib/security/addressCheck";

export const dynamic = "force-dynamic";

// POST /api/offramp/session — mint a Coinbase-hosted SELL (crypto → bank/card/
// PayPal) checkout URL. Offramp has no headless demo equivalent: cashing out
// requires a licensed provider, so without CDP credentials this returns 503.
// Coinbase charges 0% provider fees on USDC offramps.
//
// Security controls:
//   1. Authentication required (session token)
//   2. Rate limiting (10 req/10 min — money-moving, AGENTS.md Rule 2)
//   3. Zod validation via OfframpSessionSchema (amount bounds, address format)
//   4. rampGuard: embargoed countries, KYC tier 2 (off-ramp), amount limit,
//      velocity check, address verification
//   5. Step-up MFA (listed in stepUpEndpoints.ts as /offramp/execute)
//   6. Audit trail
//   7. Velocity commit after session creation
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "offramp.session", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  // ── 1. Authentication ─────────────────────────────────────────────────
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  // ── 2. Zod validation ─────────────────────────────────────────────────
  const body = await validateBody(req, OfframpSessionSchema);
  if (body instanceof NextResponse) return body;

  // ── 3. Ramp security guard ────────────────────────────────────────────
  const guard = await rampGuard({
    req,
    user: account.user,
    direction: "offramp",
    amountUsd: body.cryptoAmount,
    destinationAddress: body.address,
    chain: body.chain as Chain,
  });
  if (!guard.pass) return guard.response;

  // ── 4. Provider check ─────────────────────────────────────────────────
  if (coinbaseRampBackend === "none") {
    return NextResponse.json(
      { error: "Offramp provider not configured", mock: true },
      { status: 503 }
    );
  }
  if (!isCoinbaseRampChain(body.chain)) {
    return NextResponse.json({ error: `chain not supported for offramp: ${body.chain}` }, { status: 400 });
  }

  // ── 5. Create hosted session ──────────────────────────────────────────
  try {
    const hosted = await coinbaseOfframpUrl({
      address: body.address,
      chain: body.chain,
      asset: body.token,
      cryptoAmount: body.cryptoAmount,
      redirectUrl: body.redirectUrl,
    });

    // ── 6. Audit trail ──────────────────────────────────────────────────
    await recordRampAudit({
      userId: account.user.id,
      action: "offramp.session.created",
      direction: "offramp",
      guardId: guard.meta.guardId,
      amount: { value: String(body.cryptoAmount), currency: body.token },
      ip: trustedClientIp(req) ?? undefined,
      country: guard.meta.country ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
      kycTier: account.user.kycTier ?? 0,
      velocityFlags: guard.meta.velocityFlags,
      providerSelected: "coinbase",
      metadata: {
        chain: body.chain,
        token: body.token,
        address: body.address,
      },
    }).catch(() => {});

    // ── 7. Velocity commit ──────────────────────────────────────────────
    rampCommit({
      userId: account.user.id,
      amountUsd: body.cryptoAmount,
      country: guard.meta.country,
    }).catch(() => {});

    return NextResponse.json({ hosted }, { status: 201 });
  } catch (e) {
    console.error("[offramp] coinbase hosted url failed:", (e as Error).message);
    return NextResponse.json({ error: "Offramp session creation failed" }, { status: 502 });
  }
}
