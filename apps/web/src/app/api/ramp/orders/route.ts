import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { authenticateRampRequest } from "@/lib/ramp/partnerAuth";
import { listPartnerOrders, listUserOrders, publicRampOrder } from "@/lib/ramp/rampOrder";
import { reconcileStaleOrder } from "@/lib/ramp/staleOrders";

export const dynamic = "force-dynamic";

// GET /api/ramp/orders?limit=20 — the caller's ramp orders, newest first.
// A user sees their own; a partner key sees its partner's. Stale orders are
// resolved as they are read.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "ramp.orders.list", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const authed = await authenticateRampRequest(req, "quote");
  if (!authed.ok) return authed.res;
  const auth = authed.auth;

  const raw = Number(req.nextUrl.searchParams.get("limit") ?? 20);
  const limit = Number.isInteger(raw) && raw >= 1 && raw <= 100 ? raw : 20;

  const orders =
    auth.type === "user" ? await listUserOrders(auth.user.id, { limit }) : await listPartnerOrders(auth.partnerId, { limit });
  const fresh = await Promise.all(orders.map((o) => reconcileStaleOrder(o)));
  // Reading can resolve a stale order (a write), so nothing may cache it.
  return NextResponse.json({ orders: fresh.map(publicRampOrder) }, { headers: { "cache-control": "no-store" } });
}
