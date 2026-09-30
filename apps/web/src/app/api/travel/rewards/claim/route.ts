import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { z } from "zod";
import crypto from "crypto";
import { listTrips } from "@/lib/travel/store";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { capabilityMode, capabilityUnavailable } from "@/lib/capabilityGate";

const ClaimSchema = z.object({
  amountUsdc: z.number().positive().max(1_000_000).optional(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 0x EVM address").optional(),
});

// POST /api/travel/rewards/claim — withdraw reward balance to a wallet.
// Body: { amountUsdc?, address? } — amount defaults to the full balance.
// The claimable balance is derived from the CALLER'S confirmed trips only.
//
// NOT LIVE (REWARDS_LIVE, `unimplemented`). In production this returned a
// "settled" withdrawal on Base with a RANDOM 20-byte "txHash" — a transfer
// receipt for money that was never sent — and never deducted the claimed
// amount, so the same balance could be "withdrawn" again and again. It is now
// 503 in production; in simulation it returns no transaction hash at all.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  if (capabilityMode("REWARDS_LIVE") === null) {
    return capabilityUnavailable("REWARDS_LIVE", "Claiming travel rewards");
  }
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "travel.rewards.claim", { limit: 5, windowMs: 600_000 });
  if (limited) return limited;

  const body = await validateBody(req, ClaimSchema);
  if (body instanceof NextResponse) return body;

  const balance =
    Math.round(
      listTrips(userId)
        .filter((t) => t.status === "confirmed")
        .reduce((s, t) => s + t.cashbackUsd, 0) * 100,
    ) / 100;

  const amount = body.amountUsdc ?? balance;
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "Nothing to claim." }, { status: 400 });
  }
  if (amount > balance) {
    return NextResponse.json({ error: `Amount exceeds claimable balance of ${balance} USDC.` }, { status: 400 });
  }

  const claim = {
    id: "clm_" + crypto.randomUUID(),
    amountUsdc: amount,
    to: body.address ?? "FurlPay wallet",
    network: "base",
    // No on-chain transfer happens, so there is no hash to report.
    txHash: null,
    status: "simulated",
    simulated: true,
  };
  audit("travel.rewards_claimed", userId, { amountUsdc: amount, to: claim.to });
  return NextResponse.json({ claim });
}
