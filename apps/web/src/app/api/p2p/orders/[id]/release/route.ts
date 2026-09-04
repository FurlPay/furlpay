import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { withIdempotency } from "@/lib/idempotency";
import { releaseOrder } from "@/lib/services/p2p";
import { orderView } from "@/lib/services/p2pView";
import {
  p2pSettlementUnavailable,
  creditAsset,
  unitUsdFor,
  recordP2PTransaction,
} from "@/lib/services/p2pSettlement";

export const dynamic = "force-dynamic";

// POST /api/p2p/orders/:id/release — the seller confirms fiat received and
// hands the escrowed crypto to the buyer. This is the settling step, so it is
// idempotent per user: a retry replays rather than paying out twice.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const unavailable = p2pSettlementUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "p2p.orders.release", { limit: 20, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const { id } = await props.params;
  const idempotencyKey = req.headers.get("Idempotency-Key");

  return withIdempotency(idempotencyKey, "p2p.orders.release", async () => {
    let result;
    try {
      result = releaseOrder(id, userId);
    } catch (e) {
      const msg = (e as Error).message;
      return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
    }

    const { order, settlement } = result;
    // Price the credit off the SELLER's book: it is the side that actually held
    // the asset, so its unit value is the one that was escrowed.
    const unitUsd = unitUsdFor(settlement.sellerId, settlement.asset);
    creditAsset(settlement.buyerId, settlement.asset, settlement.amount, unitUsd);

    recordP2PTransaction(settlement.buyerId, {
      direction: "in",
      title: "P2P trade settled",
      subtitle: `${order.sn} · ${order.amount} ${order.asset}`,
      amountUsd: round2(settlement.amount * unitUsd),
      token: order.asset,
      status: "settled",
    });
    recordP2PTransaction(settlement.sellerId, {
      direction: "out",
      title: "P2P escrow released",
      subtitle: `${order.sn} · ${order.fiatAmount} ${order.fiat} received`,
      amountUsd: round2(settlement.amount * unitUsd),
      token: order.asset,
      status: "settled",
    });

    return NextResponse.json({ ok: true, order: orderView(order, userId) });
  }, { principal: userId });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
