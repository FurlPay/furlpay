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
// Read-only: it returns configuration PRESENCE (booleans and the names of
// missing env vars), never any address or secret. The handler has no auth
// check of its own, but the path is NOT in the middleware's public prefixes,
// so in practice a session is required (an anonymous request gets 401 there).
// Rate-limited as well because the middleware baseline only covers mutating
// methods.
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
            // This names the alternative rail; it does not say that rail is up.
            // The relayer is a separately configured capability (the status
            // registry records it as not configured in production), so the
            // caller is pointed at the rail map rather than promised a transfer.
            detail:
              "The relayed EIP-3009 rail needs no delegation: the user signs a transfer " +
              "authorization and a relayer pays the gas. Check the `transfers` entry in " +
              "GET /api/rails before using it; it is available only when that rail reports healthy.",
          },
    },
    { headers: { "cache-control": "no-store" } }
  );
}
