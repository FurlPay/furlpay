import { NextRequest, NextResponse } from "next/server";
import { p2pUnavailable } from "@/lib/services/p2pSettlement";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getOrder } from "@/lib/services/p2p";
import { orderView } from "@/lib/services/p2pView";

export const dynamic = "force-dynamic";

// GET /api/p2p/orders/:id — order detail for a party to it. A non-party gets
// 404, not 403: confirming that an order id exists is itself a disclosure.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "p2p.orders.get", { limit: 120, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const { id } = await props.params;
  try {
    return NextResponse.json({ order: orderView(getOrder(id, userId), userId) });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
