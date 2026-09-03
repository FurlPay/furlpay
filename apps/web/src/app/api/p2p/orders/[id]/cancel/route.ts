import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { cancelOrder, P2P_CANCEL_REASONS } from "@/lib/services/p2p";
import { orderView } from "@/lib/services/p2pView";
import {
  p2pSettlementUnavailable,
  creditAsset,
  unitUsdFor,
  recordP2PTransaction,
} from "@/lib/services/p2pSettlement";

export const dynamic = "force-dynamic";

const Cancel = z.object({
  reason: z.enum(P2P_CANCEL_REASONS),
});

// POST /api/p2p/orders/:id/cancel — unwind an order and return the escrow to
// the seller. The service refuses a seller-side cancel once the buyer has
// declared payment: at that point only an appeal can unwind the trade,
// otherwise a seller could take the fiat and cancel out of the crypto leg.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const unavailable = p2pSettlementUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "p2p.orders.cancel", { limit: 20, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const body = await validateBody(req, Cancel);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;
  try {
    const { order, refund } = cancelOrder(id, userId, body.reason);
    const unitUsd = unitUsdFor(refund.sellerId, refund.asset);
    creditAsset(refund.sellerId, refund.asset, refund.amount, unitUsd);

    recordP2PTransaction(refund.sellerId, {
      direction: "in",
      title: "P2P escrow returned",
      subtitle: `${order.sn} · cancelled (${body.reason})`,
      amountUsd: round2(refund.amount * unitUsd),
      token: order.asset,
      status: "settled",
    });

    return NextResponse.json({ ok: true, order: orderView(order, userId) });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
