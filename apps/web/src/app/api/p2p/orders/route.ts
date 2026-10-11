import { NextRequest, NextResponse } from "next/server";
import { p2pUnavailable } from "@/lib/services/p2pSettlement";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { createOrder, listOrders, P2P_LIMITS } from "@/lib/services/p2p";
import type { P2POrderStatus } from "@/lib/services/p2p";
import {
  p2pSettlementUnavailable,
  debitAsset,
  InsufficientFunds,
  recordP2PTransaction,
} from "@/lib/services/p2pSettlement";
import { orderView } from "@/lib/services/p2pView";

export const dynamic = "force-dynamic";

const CreateOrder = z
  .object({
    adId: z.string().min(1).max(64),
    amount: z.number().positive().max(P2P_LIMITS.maxAdAmount).optional(),
    fiatAmount: z.number().positive().max(P2P_LIMITS.maxFiatPerOrder).optional(),
    paymentMethodId: z.string().min(1).max(64).optional(),
  })
  .refine((v) => (v.amount === undefined) !== (v.fiatAmount === undefined), {
    message: "Provide exactly one of amount or fiatAmount",
  });

const STATUSES: P2POrderStatus[] = ["pending_payment", "paid", "released", "cancelled", "appealed"];

// GET /api/p2p/orders — the caller's orders on both sides of the book.
export async function GET(req: NextRequest) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "p2p.orders.list", { limit: 60, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const statusParam = req.nextUrl.searchParams.get("status");
  const status = STATUSES.includes(statusParam as P2POrderStatus) ? (statusParam as P2POrderStatus) : undefined;

  const orders = listOrders(userId, status).map((o) => orderView(o, userId));
  return NextResponse.json({ orders, count: orders.length });
}

// POST /api/p2p/orders — open an order against an ad. This LOCKS the seller's
// crypto into escrow, so it is idempotent per user: a retry after a timeout
// replays the original order instead of locking twice.
export async function POST(req: NextRequest) {
  const unavailable = p2pSettlementUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "p2p.orders.create", { limit: 20, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const body = await validateBody(req, CreateOrder);
  if (body instanceof NextResponse) return body;

  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, "p2p.orders.create", async () => {
    // Funding happens INSIDE createOrder, synchronously, before any state is
    // written, so an unfunded order never exists — not even for one tick.
    //
    // This used to create the order first and debit second, unwinding with an
    // `await import()` + cancelOrder when the seller could not fund it. For the
    // length of that await a live order backed by nothing was visible and
    // releasable: a release in the gap credited the buyer from escrow nobody
    // had paid into. (The unwind also cancelled AS THE TAKER, which the seller
    // payment-window rule in cancelOrder now refuses on a buy ad.)
    let created;
    try {
      created = createOrder(userId, body, { fundEscrow: debitAsset });
    } catch (e) {
      if (e instanceof InsufficientFunds) {
        return NextResponse.json({ ok: false, error: "seller_insufficient_balance" }, { status: 409 });
      }
      const msg = (e as Error).message;
      return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 400 });
    }

    const { order, escrow } = created;

    recordP2PTransaction(escrow.sellerId, {
      direction: "out",
      title: "P2P escrow locked",
      subtitle: `${order.sn} · ${order.amount} ${order.asset}`,
      amountUsd: 0,
      token: order.asset,
      status: "escrow",
    });

    return NextResponse.json({ ok: true, order: orderView(order, userId) }, { status: 201 });
  }, { principal: userId, request: body });
}
