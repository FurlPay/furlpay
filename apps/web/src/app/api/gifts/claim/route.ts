import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { claimPacket, packetView } from "@/lib/services/gifting";
import { creditAsset, unitUsdFor, p2pSettlementUnavailable } from "@/lib/services/p2pSettlement";
import { newTx, recordTransaction } from "@/lib/store";

export const dynamic = "force-dynamic";

const Claim = z.object({
  // The code is the capability. Fixed alphabet and length, so a malformed one
  // is rejected before it reaches the lookup.
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(8)
    .max(16)
    .regex(/^[A-Z0-9]+$/, "Invalid packet code"),
});

// POST /api/gifts/claim — take a slot from a red packet.
//
// Tighter rate limit than most routes: this endpoint takes a guessable-shaped
// code and pays money for a correct one, which makes it the natural target for
// enumeration. The code alphabet gives ~10^15 possibilities; the budget is what
// makes walking them pointless.
export async function POST(req: NextRequest) {
  const unavailable = p2pSettlementUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "gifts.claim", { limit: 10, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const body = await validateBody(req, Claim);
  if (body instanceof NextResponse) return body;

  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, "gifts.claim", async () => {
    let result;
    try {
      result = claimPacket(body.code, userId);
    } catch (e) {
      const msg = (e as Error).message;
      return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
    }

    const { packet, amount } = result;
    const unitUsd = unitUsdFor(packet.senderId, packet.token);
    creditAsset(userId, packet.token, amount, unitUsd);

    recordTransaction(
      userId,
      newTx({
        category: "transfer",
        direction: "in",
        title: "Red packet claimed",
        subtitle: packet.message || "Lucky money",
        amountUsd: Math.round(amount * unitUsd * 100) / 100,
        token: packet.token,
        chain: "arbitrum",
        status: "settled",
      }),
    );

    return NextResponse.json({ ok: true, amount, token: packet.token, packet: packetView(packet, userId) });
  }, { principal: userId });
}
