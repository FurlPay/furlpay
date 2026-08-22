import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { newTx, persistAccount, recordTransaction, type UserAccount } from "@/lib/store";
import { withIdempotency } from "@/lib/idempotency";
import { recordMovement } from "@/lib/ledger";
import { bySymbol } from "@/lib/markets/catalog";
import { requireUser } from "@/lib/authz";
import { OrderSchema, parse } from "@/lib/schemas";
import { recordBuy, recordSell, projectHoldings } from "@/lib/corporateActions/projector";
import { FeatureDisabledError } from "@/lib/flags";
import { getBrokerage } from "@/lib/brokerage";
import {
  BrokerageIndeterminateError,
  BrokerageRejectedError,
  type BrokerageOrder,
  type OrderSide,
  type OrderType,
  type TimeInForce,
} from "@/lib/brokerage/types";
import {
  applyProviderOrder,
  createOrderRecord,
  getOrderRecord,
  markSubmitted,
  OrderNotRecordableError,
} from "@/lib/brokerage/orderStore";

// POST /api/investing/order — place an equity / ETF order.
//
// WHAT CHANGED. This route used to be entirely internal: it minted an order id
// with crypto.randomBytes, decided `status = type === "market" ? "filled" :
// "pending"` on the spot, computed a fill price from the last quote, and moved
// the lot ledger — all without a single call to a brokerage. Every "filled"
// it ever returned described an order that had never reached a market.
//
// It now goes through the brokerage port (lib/brokerage). The sequence, and
// why each step is where it is:
//
//   1. RECORD FIRST. The order is written as `created` BEFORE the provider is
//      called. A submission that times out therefore leaves a record of an
//      order that may be live at the venue. Writing only on success is how an
//      order becomes real to the market and invisible to us.
//
//   2. SUBMIT with our client order id. That id is the provider's idempotency
//      key, so a retried request cannot open a second position.
//
//   3. MOVE THE LEDGER ONLY ON A PROVIDER-REPORTED FILL, using the provider's
//      filled quantity and average price. Never a locally computed one. The
//      quote we showed the user is not the price they got.
//
//   4. AN INDETERMINATE FAILURE IS NOT A FAILURE. A timeout means the order may
//      exist. It returns 202 with the client order id — "we do not know yet,
//      here is how to ask" — rather than an error that invites a retry.
//
// Accepts EITHER `notional` (USD) OR `qty` (shares), never both, matching the
// provider contract. OrderSchema enforces types, enums and positivity.

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const parsed = parse(OrderSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;

  // Mobile networks make "tap → timeout → tap again" routine, and without a key
  // that sequence is two orders. Scoped per user, so one client's key cannot
  // replay another account's request.
  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, `investing.order:${account.user.id}`, () =>
    executeOrder(account, parsed.data, idempotencyKey)
  );
}

type OrderInput = ReturnType<typeof OrderSchema.parse>;

async function executeOrder(
  account: UserAccount,
  input: OrderInput,
  idempotencyKey: string | null
): Promise<NextResponse> {
  const { symbol, side, notional, qty, limit_price, stop_price } = input;
  const type = (input.type ?? "market") as OrderType;
  const timeInForce = (input.time_in_force ?? "day") as TimeInForce;

  // ---- Shape validation, before anything is recorded --------------------
  const hasNotional = notional !== undefined && notional !== null;
  const hasQty = qty !== undefined && qty !== null;
  if (hasNotional && hasQty) {
    return NextResponse.json({ error: "Provide either qty or notional, not both" }, { status: 400 });
  }
  if (!hasNotional && !hasQty) {
    return NextResponse.json({ error: "Provide qty or notional" }, { status: 400 });
  }
  if ((type === "limit" || type === "stop_limit") && limit_price === undefined) {
    return NextResponse.json({ error: "limit_price required for limit/stop_limit orders" }, { status: 400 });
  }
  if ((type === "stop" || type === "stop_limit") && stop_price === undefined) {
    return NextResponse.json({ error: "stop_price required for stop/stop_limit orders" }, { status: 400 });
  }

  const sym = String(symbol).toUpperCase();
  const asset = bySymbol.get(sym);
  if (!asset || asset.kind === "crypto") {
    return NextResponse.json({ error: "Symbol not found" }, { status: 404 });
  }

  // ---- The brokerage -----------------------------------------------------
  let brokerage;
  try {
    brokerage = getBrokerage();
  } catch (e) {
    if (e instanceof FeatureDisabledError) {
      // Honest 503. The capability is off, so no order was placed — as opposed
      // to the old behaviour, which reported a fill.
      return NextResponse.json(
        { error: "trading_unavailable", detail: e.message, flag: e.flag, reason: e.blocker.reason },
        { status: 503 }
      );
    }
    throw e;
  }

  // The client order id IS the idempotency key when one was supplied, so a
  // retry carrying the same header reaches the same provider-side order even
  // if our own idempotency cache has expired.
  const clientOrderId = deriveClientOrderId(account.user.id, idempotencyKey);

  // Already known? Return it rather than submitting again.
  const existing = await getOrderRecord(clientOrderId);
  if (existing) {
    return NextResponse.json(orderResponse(existing.status, existing, null), { status: 200 });
  }

  // ---- 1. Record before submitting --------------------------------------
  try {
    await createOrderRecord({
      clientOrderId,
      userId: account.user.id,
      symbol: sym,
      side: side as OrderSide,
      type,
      timeInForce,
      qty: hasQty ? Number(qty) : null,
      notional: hasNotional ? Number(notional) : null,
      limitPrice: limit_price ?? null,
      stopPrice: stop_price ?? null,
      provider: brokerage.name,
      providerIsLive: brokerage.isLive,
    });
  } catch (e) {
    if (e instanceof OrderNotRecordableError) {
      // Refuse to trade. An order we cannot write down cannot be reconciled,
      // cancelled or explained to the person who placed it.
      return NextResponse.json(
        { error: "order_not_recordable", detail: "Order storage is unavailable. No order was placed." },
        { status: 503 }
      );
    }
    throw e;
  }

  // ---- 2. Submit ---------------------------------------------------------
  await markSubmitted(clientOrderId);
  let placed: BrokerageOrder;
  try {
    placed = await brokerage.placeOrder({
      clientOrderId,
      symbol: sym,
      side: side as OrderSide,
      type,
      timeInForce,
      qty: hasQty ? Number(qty) : null,
      notional: hasNotional ? Number(notional) : null,
      limitPrice: limit_price ?? null,
      stopPrice: stop_price ?? null,
    });
  } catch (e) {
    if (e instanceof BrokerageIndeterminateError) {
      // 202, not 5xx. The order may exist; the client must poll, not retry.
      return NextResponse.json(
        {
          status: "unknown",
          orderId: clientOrderId,
          detail:
            "The order was submitted but its status could not be confirmed. It may have been accepted. " +
            "Check its status before placing another.",
        },
        { status: 202 }
      );
    }
    if (e instanceof BrokerageRejectedError) {
      await applyProviderOrder(clientOrderId, rejectedOrder(clientOrderId, sym, side as OrderSide, type, timeInForce, e.message), "submit");
      return NextResponse.json({ error: "order_rejected", detail: e.message }, { status: e.status >= 400 && e.status < 500 ? 400 : 502 });
    }
    throw e;
  }

  const applied = await applyProviderOrder(clientOrderId, placed, "submit");
  const record = applied.record;

  // ---- 3. Ledger, only on a provider-reported fill -----------------------
  //
  // The condition is deliberately narrow: a fill quantity AND an average price,
  // both stated by the provider. A `filled` status with no quantity is not
  // enough to move a tax lot — the lot needs a real number.
  let realizedGain: number | null = null;
  const filledQty = placed.filledQty;
  const fillPrice = placed.filledAvgPrice;

  if ((placed.status === "filled" || placed.status === "partially_filled") && filledQty != null && filledQty > 0 && fillPrice != null && fillPrice > 0) {
    const notionalUsd = filledQty * fillPrice;

    let holding = account.holdings.find((h) => h.symbol === sym);
    if (!holding) {
      holding = {
        symbol: sym,
        name: asset.name,
        shares: 0,
        price: fillPrice,
        changePct: 0,
        marketValue: 0,
        costBasis: 0,
      };
      account.holdings.push(holding);
    }
    // Mark to the price actually paid, not the pre-trade quote.
    holding.price = fillPrice;

    if (side === "buy") {
      account.tradeLots.push(
        recordBuy({
          id: "lot_" + crypto.randomBytes(6).toString("hex"),
          userId: account.user.id,
          symbol: sym,
          quantity: filledQty,
          costBasis: notionalUsd,
          orderId: clientOrderId,
          provenance: "execution",
        })
      );
    } else {
      // An account hydrated from Postgres has no lots yet (storeDb
      // .accountFromRow). Selling against an empty ledger would throw
      // "insufficient position" for a holder who genuinely owns the shares, so
      // backfill from the aggregate rather than rejecting a valid order.
      if (!account.tradeLots.some((l) => l.symbol === sym && l.status === "open") && holding.shares > 0) {
        account.tradeLots.push(
          recordBuy({
            id: "lot_backfill_" + crypto.randomBytes(4).toString("hex"),
            userId: account.user.id,
            symbol: sym,
            quantity: holding.shares,
            costBasis: holding.costBasis ?? 0,
            acquiredAt: new Date(Date.now() - 365 * 86400_000).toISOString(),
            provenance: "backfill",
          })
        );
      }
      try {
        const sale = recordSell(account.tradeLots, sym, filledQty, notionalUsd, "fifo");
        account.tradeLots.splice(0, account.tradeLots.length, ...sale.remaining);
        realizedGain = sale.realizedGain;
      } catch (e) {
        // The provider already filled this. Refusing the ledger write now would
        // leave a real position unrecorded, so this is a 500 that must page
        // someone — not a 400 telling the user their valid order was invalid.
        return NextResponse.json(
          {
            error: "ledger_write_failed",
            detail: (e as Error).message,
            orderId: clientOrderId,
            warning: "The order executed at the broker but could not be recorded locally. Reconciliation is required.",
          },
          { status: 500 }
        );
      }
    }

    const projected = projectHoldings(
      account.tradeLots.filter((l) => l.symbol === sym),
      [],
      () => ({ price: fillPrice, changePct: holding.changePct, name: holding.name })
    );
    const next = projected.find((p) => p.symbol === sym);
    holding.shares = next?.shares ?? 0;
    holding.costBasis = next?.costBasis ?? 0;
    holding.marketValue = round2(holding.shares * fillPrice);

    recordTransaction(
      account.user.id,
      newTx({
        category: "invest",
        direction: side === "buy" ? "out" : "in",
        title: `${side === "buy" ? "Bought" : "Sold"} ${sym}`,
        // Names the actual provider, so a simulated fill is identifiable in the
        // user's own transaction history rather than labelled "Alpaca".
        subtitle: `${brokerage.name} · ${type} · ${filledQty.toFixed(4)} sh @ ${fillPrice.toFixed(2)}`,
        amountUsd: notionalUsd,
        status: "settled",
      })
    );
    recordMovement(side === "buy" ? "out" : "in", notionalUsd, `${side === "buy" ? "Buy" : "Sell"} ${sym}`, account.user.id);

    // Confirm the lot is DURABLE before telling the client it filled. The
    // response says "filled" and the lot behind it is the tax record; measured
    // against staging on 2026-07-19 a fire-and-forget flush completed 991ms
    // AFTER the 200, and a crash in that window loses the lot.
    await persistAccount(account.user.id);
  }

  return NextResponse.json(orderResponse(placed.status, record, realizedGain, placed));
}

/**
 * The client order id.
 *
 * Derived from the caller's Idempotency-Key when present, so the SAME retried
 * request reaches the same provider-side order even after our idempotency cache
 * has expired. Hashed with the user id so two accounts cannot collide on a
 * guessable key, and so the key itself is not echoed to the provider.
 *
 * Without a header there is nothing to be idempotent about, and a fresh random
 * id is correct — two deliberate taps are two orders.
 */
function deriveClientOrderId(userId: string, idempotencyKey: string | null): string {
  if (!idempotencyKey) return "fp_" + crypto.randomBytes(12).toString("hex");
  const digest = crypto
    .createHash("sha256")
    .update(`${userId}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 24);
  return `fp_${digest}`;
}

/** A synthetic record of a definite rejection, so the refusal is stored. */
function rejectedOrder(
  clientOrderId: string,
  symbol: string,
  side: OrderSide,
  type: OrderType,
  timeInForce: TimeInForce,
  reason: string
): BrokerageOrder {
  return {
    clientOrderId,
    providerOrderId: null,
    symbol,
    side,
    type,
    timeInForce,
    status: "rejected",
    qty: null,
    notional: null,
    limitPrice: null,
    stopPrice: null,
    filledQty: null,
    filledAvgPrice: null,
    submittedAt: new Date().toISOString(),
    filledAt: null,
    canceledAt: null,
    expiredAt: null,
    rejectReason: reason,
  };
}

function orderResponse(
  status: string,
  record: { clientOrderId: string; symbol: string; side: string; type: string; timeInForce: string; providerOrderId: string | null; provider: string; providerIsLive: boolean; filledQty: number | null; filledAvgPrice: number | null; limitPrice: number | null; stopPrice: number | null } | null,
  realizedGain: number | null,
  placed?: BrokerageOrder
) {
  return {
    orderId: record?.clientOrderId ?? placed?.clientOrderId ?? null,
    providerOrderId: record?.providerOrderId ?? placed?.providerOrderId ?? null,
    status,
    symbol: record?.symbol ?? placed?.symbol ?? null,
    side: record?.side ?? placed?.side ?? null,
    type: record?.type ?? placed?.type ?? null,
    time_in_force: record?.timeInForce ?? placed?.timeInForce ?? null,
    // Null, not 0, when the provider has not reported a fill. A zero here
    // reads as "filled nothing", which is a different fact from "not yet".
    filledQty: record?.filledQty ?? placed?.filledQty ?? null,
    filledAvgPrice: record?.filledAvgPrice ?? placed?.filledAvgPrice ?? null,
    limit_price: record?.limitPrice ?? placed?.limitPrice ?? null,
    stop_price: record?.stopPrice ?? placed?.stopPrice ?? null,
    realizedGain,
    /** Where this order actually went. A client rendering a confirmation must
     *  read `live` before calling it a real trade. */
    execution: {
      provider: record?.provider ?? "unknown",
      live: record?.providerIsLive ?? false,
    },
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
