import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { resolveAll, stakingIsConfigured } from "@/lib/staking/registry";

export const dynamic = "force-dynamic";

// GET /api/staking/protocols — the liquid-staking protocols this deployment
// has verified, with their contract addresses.
//
// THE RESPONSE IS WHAT THE APP WILL SEND FUNDS TO, which is why it is
// authenticated and why the registry refuses to emit an address that no person
// has verified against the protocol's published documentation. See
// lib/staking/registry.ts — the catalogue ships with `address: null` and an
// unverified entry can never reach this response as stakable.
//
// UNCONFIGURED IS A 200, NOT A 501. Unlike NFT indexing, there is something
// truthful to say here even with nothing configured: the protocols exist, the
// app can describe them, and it can explain that none is available yet. A 501
// would collapse "we support staking but nobody set it up" into "this endpoint
// is broken", and the app would render an error where an explanation belongs.

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(
    req,
    "staking.protocols",
    { limit: 60, windowMs: 60_000 },
    auth.account.user.id,
  );
  if (limited) return limited;

  const protocols = resolveAll();

  return NextResponse.json({
    configured: stakingIsConfigured(),
    protocols,
    // Stated on every response so the client never has to infer it from an
    // empty list, and so this distinction survives into the UI copy: FurlPay
    // Earn is Morpho lending (borrower interest, instant exit); staking is
    // consensus rewards behind a withdrawal queue. Different yield source,
    // different risk, different exit.
    notice:
      "Liquid staking, not validator delegation — consumer native staking does not exist on these networks. " +
      "Your assets are staked by a third-party protocol, not by FurlPay. This is separate from FurlPay Earn.",
  });
}
