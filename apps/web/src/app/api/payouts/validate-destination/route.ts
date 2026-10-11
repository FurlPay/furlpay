import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { PAYOUT_RAILS, checkRailDestination, railStatus, type PayoutRail } from "@/lib/payouts/rails";
import { ownershipSupport } from "@/lib/payouts/ownership";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/payouts/validate-destination
//
// Validates a payout destination WITHOUT saving it. This is the endpoint the
// Add Wallet flow calls before it will let anyone press Confirm.
//
// The handler is deliberately free of account checks and side effects: it
// stores nothing, reads no account state, and tells the caller only what is
// already true of the string they typed. That makes it safe to call on every
// blur. It is not anonymous, though: the path is NOT in the middleware's public
// prefixes, so the caller needs a session (which a user who is still
// onboarding already has).
//
// It does NOT confirm ownership. A destination that validates here is
// well-formed and correctly paired with its network — nothing more. Proving
// control is a separate step with a separate endpoint, because conflating
// "this address is real" with "this address is yours" is exactly how a
// compromised account redirects a payout.
// ---------------------------------------------------------------------------

const Body = z.object({
  rail: z.enum(PAYOUT_RAILS as unknown as [PayoutRail, ...PayoutRail[]]),
  network: z.string().trim().min(1).max(64),
  destination: z.string().trim().min(1).max(200),
  assetAddress: z.string().trim().min(1).max(120).optional(),
});

export async function POST(req: NextRequest) {
  // Budgeted per IP: this is a validation oracle, and an unbounded one is a
  // free address-format checker for anyone who wants to grind through inputs.
  const limited = await rateLimitOr429(req, "payouts.validate", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_request", detail: "Provide rail, network and destination." },
      { status: 400 }
    );
  }

  const result = checkRailDestination(parsed.data);

  if (!result.ok) {
    // 200, not 4xx. A rejected address is a normal outcome of a form the user
    // is still filling in, not a client error — and an error status would make
    // every typo look like a broken integration in the browser console.
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  }

  return NextResponse.json(
    {
      ...result,
      railStatus: railStatus(result.rail),
      // The UI needs to know whether it can offer a signature step at all, so
      // that an unverifiable rail says so rather than showing a button that
      // cannot work.
      ownership: ownershipSupport(result.rail),
    },
    { headers: { "cache-control": "no-store" } }
  );
}
