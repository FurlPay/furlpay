import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getBrokerageOrNull, brokerageIsLive } from "@/lib/brokerage";
import { listUserOrders } from "@/lib/brokerage/orderStore";
import { syncOpenOrders } from "@/lib/brokerage/sync";

// GET /api/investing/orders — the acting user's order history.
//
// SYNCS BEFORE IT ANSWERS. Opening the orders screen is the moment a user most
// wants current state, and on serverless there is no long-lived stream keeping
// it fresh (see lib/brokerage/sync.ts for why). A read-triggered sync means the
// screen someone is looking at is the screen that gets updated, without waiting
// for a cron tick.
//
// The sync is bounded and best-effort: it polls at most a handful of open
// orders, and a provider outage degrades to serving the stored records rather
// than failing the request. Stored records are real — they are our own
// authoritative copy — they are simply as fresh as the last successful sync,
// and `staleness` says so rather than leaving the reader to assume.

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "investing.orders", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const userId = auth.account.user.id;
  const brokerage = getBrokerageOrNull();

  let synced: { checked: number; advanced: number; orphaned: number } | null = null;
  let syncError: string | null = null;

  if (brokerage) {
    try {
      // 15 is enough to cover any realistic set of working orders while
      // bounding the request's latency — this runs inside a page load.
      const result = await syncOpenOrders(userId, brokerage, { max: 15 });
      synced = {
        checked: result.checked,
        advanced: result.advanced,
        orphaned: result.orphaned.length,
      };
      if (result.errors.length > 0) syncError = result.errors[0];
    } catch (e) {
      syncError = e instanceof Error ? e.message : "sync failed";
    }
  }

  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 50));
  const orders = await listUserOrders(userId, limit);

  return NextResponse.json({
    orders: orders.map((o) => ({
      orderId: o.clientOrderId,
      providerOrderId: o.providerOrderId,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      timeInForce: o.timeInForce,
      status: o.status,
      qty: o.qty,
      notional: o.notional,
      limitPrice: o.limitPrice,
      stopPrice: o.stopPrice,
      // Null, not 0, when the provider has not reported a fill — "filled
      // nothing" and "not yet reported" are different facts.
      filledQty: o.filledQty,
      filledAvgPrice: o.filledAvgPrice,
      createdAt: o.createdAt,
      submittedAt: o.submittedAt,
      terminalAt: o.terminalAt,
      rejectReason: o.rejectReason,
      /** Whether this order reached a real venue. A UI must read it before
       *  calling anything a real trade. */
      execution: { provider: o.provider, live: o.providerIsLive },
      /** How it got to its current status — the answer a single mutable
       *  status field can never give. */
      history: o.history,
    })),
    /** What was actually refreshed while serving this request. */
    sync: synced,
    /** Present when the provider could not be reached. The orders above are
     *  our stored records, current as of their own `updatedAt`. */
    staleness: syncError ? { reason: "provider_unreachable", detail: syncError } : null,
    brokerage: {
      available: brokerage !== null,
      live: brokerageIsLive(),
      provider: brokerage?.name ?? null,
    },
  });
}
