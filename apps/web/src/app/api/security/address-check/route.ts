import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { verifyDestinationAddress } from "@/lib/security/addressCheck";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/security/address-check — screen a destination before signing.
//
// PUBLIC AND UNAUTHENTICATED by design. The check has to run before a wallet
// is connected (people paste an address to sanity-check it), and gating a
// safety feature behind a login means the users most at risk are the ones who
// do not get it.
//
// PRIVACY. `historyHint` is a list of who the caller pays, which is sensitive
// on its own. It is used only for the local lookalike comparison, never
// stored, never logged, and never forwarded. The response echoes back only the
// address that was submitted.
//
// The screening itself is pure and synchronous (lib/security/addressCheck.ts),
// so this route exists to give non-web clients — the mobile app, a partner
// integration — the same primitive the web send screen calls directly.
// ---------------------------------------------------------------------------

const Schema = z.object({
  address: z.string().trim().min(1).max(128),
  chain: z.enum(["base", "solana", "arbitrum", "ethereum"]).default("base"),
  // Capped at 20: the lookalike check only needs recent counterparties, and an
  // unbounded list is a way to make the server do unbounded work.
  historyHint: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
  selfAddress: z.string().trim().min(1).max(128).optional(),
});

export async function POST(req: NextRequest) {
  // Generous but bounded: a send screen calls this on debounce as the user
  // types, so a tight budget would break the feature it protects.
  const limited = await rateLimitOr429(req, "security.address-check", {
    limit: 100,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const body = await validateBody(req, Schema);
  if (body instanceof NextResponse) return body;

  const report = verifyDestinationAddress(
    body.address,
    body.chain ?? "base",
    body.historyHint ?? [],
    body.selfAddress
  );

  return NextResponse.json(report, {
    // A screening result is about one address at one moment and must never be
    // served from a shared cache to a different user.
    headers: { "cache-control": "no-store" },
  });
}
