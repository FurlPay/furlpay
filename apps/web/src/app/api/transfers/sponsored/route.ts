import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { sponsoredCapability } from "@/lib/eip7702";

export const dynamic = "force-dynamic";

// GET /api/transfers/sponsored — capability probe for EIP-7702 + Circle
// Paymaster ("pay gas in USDC from a plain EOA").
//
// A client MUST call this before asking a user to sign an EIP-7702
// authorization. That signature points the user's EOA at code which executes
// with the account's full authority and there is no undo, so collecting one and
// only then discovering there is no bundler to submit it to would be the worst
// possible ordering. Ask first, sign second.
//
// Public and read-only: it returns configuration PRESENCE (booleans and the
// names of missing env vars), never any address or secret. Rate-limited because
// the middleware baseline only covers mutating methods, so an unauthenticated
// GET has no backstop of its own.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "transfers.sponsored", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const capability = sponsoredCapability();

  return NextResponse.json(
    {
      ...capability,
      // Stated plainly so a client cannot mistake "the scheme is described" for
      // "the scheme is live". `anyAvailable` is the field to branch on.
      live: capability.anyAvailable,
      alternative: capability.anyAvailable
        ? undefined
        : {
            scheme: "eip3009-transfer-with-authorization",
            path: "/api/transfers/gasless",
            detail:
              "Sponsored transfers are available today: FurlPay's relayer pays the gas " +
              "and the user signs an EIP-3009 authorization. No delegation required.",
          },
    },
    { headers: { "cache-control": "no-store" } }
  );
}
