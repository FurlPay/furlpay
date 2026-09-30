import { NextRequest, NextResponse } from "next/server";
import { p2pUnavailable } from "@/lib/services/p2pSettlement";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { markPaid } from "@/lib/services/p2p";
import { orderView } from "@/lib/services/p2pView";

export const dynamic = "force-dynamic";

// POST /api/p2p/orders/:id/pay — the buyer declares the fiat sent.
//
// No body: the only fact being asserted is "I paid", and the amount is already
// fixed by the order. Accepting a client-supplied amount here would let a buyer
// claim a different figure than the one escrow was sized against.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "p2p.orders.pay", { limit: 20, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const { id } = await props.params;
  try {
    return NextResponse.json({ ok: true, order: orderView(markPaid(id, userId), userId) });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}
