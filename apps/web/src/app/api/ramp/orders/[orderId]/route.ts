import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { authenticateRampRequest } from "@/lib/ramp/partnerAuth";
import { getRampOrder, publicRampOrder } from "@/lib/ramp/rampOrder";
import { reconcileStaleOrder } from "@/lib/ramp/staleOrders";

export const dynamic = "force-dynamic";

// GET /api/ramp/orders/:orderId — one ramp order, for its owner: the FurlPay
// user who opened it, or the partner whose key did. Anyone else gets 404, the
// same as a missing id, so order ids cannot be probed. Reading an order also
// resolves it if it is stale (lib/ramp/staleOrders.ts).
export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const limited = await rateLimitOr429(req, "ramp.orders.read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const authed = await authenticateRampRequest(req, "quote");
  if (!authed.ok) return authed.res;
  const auth = authed.auth;

  const { orderId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const order = await getRampOrder(orderId);
  const owns =
    order &&
    ((auth.type === "user" && order.userId === auth.user.id) ||
      (auth.type === "partner" && order.partnerId === auth.partnerId));
  if (!order || !owns) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Reading can resolve a stale order (a write), so nothing may cache it.
  return NextResponse.json(publicRampOrder(await reconcileStaleOrder(order)), { headers: { "cache-control": "no-store" } });
}
