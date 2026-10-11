import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTrip, updateTrip } from "@/lib/travel/store";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { kvSetNx } from "@/lib/kv";
import { PAY_TO } from "@/lib/x402";
import { audit } from "@/lib/audit";
import { verifyUsdcPayment, usdToAtomicUsdc } from "@/lib/travel/settlementProof";
import { verifiedReceiver } from "@/lib/receiveAddress";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/travel/settle — confirm a trip against a REAL on-chain payment.
//
// WHAT THIS USED TO DO
//   const settled = updateTrip(id, userId, { status: "confirmed" });
//   return NextResponse.json({ verified: true, settled: true, trip: settled });
//
// It read no proof, checked no chain, and returned `verified: true`. Any
// authenticated user could confirm any of their own bookings for free, and the
// response asserted a verification that had not happened. Nothing called it,
// which is the only reason this was not exploited.
//
// WHAT IT DOES NOW
//   1. Validates the body (Zod) — AGENTS.md rule 1.
//   2. Rate limits — settling is money-adjacent, so it gets its own budget
//      tighter than the middleware baseline (AGENTS.md rule 2).
//   3. Verifies the submitted tx on-chain: right USDC contract, right
//      recipient, sufficient amount, sufficient confirmation depth.
//   4. Claims the tx hash single-use, so ONE payment cannot confirm TWO trips.
//   5. Only then flips the trip to confirmed.
//
// It never reports `verified: true` for anything it did not verify. A trip
// already confirmed is returned as-is (idempotent), not re-settled.
// ---------------------------------------------------------------------------

const SettleSchema = z.object({
  bookingId: z.string().min(1).max(128).optional(),
  tripId: z.string().min(1).max(128).optional(),
  /** On-chain proof of payment. */
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "txHash must be 0x + 64 hex characters"),
  network: z.enum(["base", "arbitrum"]),
});

/** A settled tx hash is burned for 30 days — far longer than any booking flow. */
const PROOF_CLAIM_TTL_SECONDS = 30 * 24 * 3600;

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  // Per-user, not just per-IP: proof submission is the step an attacker would
  // brute-force against, and NAT puts many honest users behind one address.
  const limited = await rateLimitOr429(req, "travel.settle", { limit: 20, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const body = await validateBody(req, SettleSchema);
  if (body instanceof NextResponse) return body;

  const id = String(body.bookingId ?? body.tripId ?? "");
  if (!id) {
    return NextResponse.json({ error: "missing_booking_id" }, { status: 400 });
  }

  // Scoped to the caller: settling flips a booking to confirmed, so an id that
  // isn't theirs must 404 rather than settle someone else's trip.
  const trip = getTrip(id, userId);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Idempotent: a retry after a dropped response must not need a second
  // payment, and must not burn a second proof.
  if (trip.status === "confirmed") {
    return NextResponse.json({ verified: true, settled: true, trip, alreadyConfirmed: true });
  }

  const amountUsd = trip.amountUsd;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    // Without a price there is nothing to verify the payment AGAINST, and
    // "verify against whatever they sent" is not verification.
    return NextResponse.json(
      { error: "trip_not_priced", detail: "This trip has no settled price to verify a payment against." },
      { status: 409 }
    );
  }

  const expectedAtomic = usdToAtomicUsdc(amountUsd);

  // THE PAYER. A transfer to PAY_TO is public on-chain, so without binding it
  // to its sender anyone could submit a stranger's payment hash to confirm
  // their own trip first, and the real payer's submission would then fail as
  // "already used". The payment must come from the caller's verified,
  // EIP-191-linked wallet; with none linked there is no payer to bind, so the
  // request is refused rather than settled on an unattributable transfer.
  const payer = await verifiedReceiver(userId);
  if (!payer) {
    return NextResponse.json(
      {
        verified: false,
        settled: false,
        error: "payer_wallet_not_linked",
        detail: "Link and verify the wallet you paid from before settling a booking.",
      },
      { status: 409 }
    );
  }

  const proof = await verifyUsdcPayment({
    txHash: body.txHash,
    network: body.network,
    expectedTo: PAY_TO,
    expectedAtomic,
    expectedFrom: payer,
    // Bind the proof to THIS booking (finding FP-SET-15): a transfer mined
    // before the trip existed cannot be its payment, whatever the KV claim
    // below remembers. 120s of slack for clock skew between our createdAt and
    // the chain's block timestamp.
    notBefore: Math.floor(Date.parse(trip.createdAt) / 1000) - 120,
  });

  if (!proof.ok) {
    // 402 for "your payment isn't good enough yet" vs 409 for a terminal
    // mismatch: the client should poll the first and give up on the second.
    const retryable = proof.reason === "tx_not_found" || proof.reason === "insufficient_confirmations";
    audit("travel.settle.rejected", userId, {
      tripId: id,
      reason: proof.reason,
      txHash: body.txHash,
      network: body.network,
    });
    return NextResponse.json(
      {
        verified: false,
        settled: false,
        error: proof.reason,
        detail: proof.detail,
        ...(proof.confirmations !== undefined
          ? { confirmations: proof.confirmations, requiredConfirmations: proof.requiredConfirmations }
          : {}),
      },
      { status: retryable ? 402 : 409 }
    );
  }

  // ONE PAYMENT, ONE TRIP. Claimed atomically after verification but before
  // the status flip, so two concurrent requests carrying the same hash cannot
  // both confirm — and so a real payment for trip A cannot be replayed to
  // confirm trip B.
  const claimed = await kvSetNx(`travel:settle:proof:${body.network}:${body.txHash}`, id, PROOF_CLAIM_TTL_SECONDS);
  if (!claimed) {
    return NextResponse.json(
      {
        verified: true,
        settled: false,
        error: "proof_already_used",
        detail: "This transaction has already been used to settle a booking.",
      },
      { status: 409 }
    );
  }

  const settled = updateTrip(id, userId, { status: "confirmed" });
  audit("travel.settle.confirmed", userId, {
    tripId: id,
    txHash: proof.txHash,
    network: proof.network,
    paidAtomic: proof.paidAtomic,
    confirmations: proof.confirmations,
  });

  return NextResponse.json({
    verified: true,
    settled: true,
    trip: settled,
    proof: {
      txHash: proof.txHash,
      network: proof.network,
      paidAtomic: proof.paidAtomic,
      confirmations: proof.confirmations,
    },
  });
}
