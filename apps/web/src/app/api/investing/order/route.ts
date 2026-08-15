import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { newTx, persistAccount, recordTransaction, type UserAccount } from "@/lib/store";
import { withIdempotency } from "@/lib/idempotency";
import { recordMovement } from "@/lib/ledger";
import { bySymbol } from "@/lib/markets/catalog";
import { quoteFor } from "@/lib/markets/quotes";
import { requireUser } from "@/lib/authz";
import { OrderSchema, parse } from "@/lib/schemas";
import { projectHoldings, recordBuy, recordSell } from "@/lib/corporateActions/projector";

// POST /api/investing/order — place a fractional stock/ETF order (Alpaca).
// Accepts EITHER `notional` (USD) OR `qty` (shares), never both (→ 400),
// matching Alpaca's contract. Supports market/limit/stop/stop_limit + TIF.
// OrderSchema enforces types/enums AND positivity — the previous manual checks
// never rejected a negative notional, which on a "buy" shrank the position.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const parsed = parse(OrderSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;

  // Mobile networks make "tap → timeout → tap again" routine, and without a
  // key that sequence is two orders. Same contract as wallets/transfer:
  // scoped per user, so one client's key cannot replay another account's
  // request. No key (older clients, curl) → the handler runs normally.
  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, `investing.order:${account.user.id}`, () =>
    executeOrder(account, parsed.data)
  );
}

type OrderInput = ReturnType<typeof OrderSchema.parse>;

async function executeOrder(account: UserAccount, input: OrderInput): Promise<NextResponse> {
  const { symbol, side, notional, qty, limit_price, stop_price } = input;
  const type = input.type ?? "market";
  const time_in_force = input.time_in_force ?? "day";

  // Alpaca: qty and notional are mutually exclusive; exactly one required.
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
  let holding = account.holdings.find((h) => h.symbol === sym);
  if (!holding) {
    // First trade in a catalog asset opens a fresh position at the latest quote.
    const asset = bySymbol.get(sym);
    if (!asset || asset.kind === "crypto") {
      return NextResponse.json({ error: "Symbol not found" }, { status: 404 });
    }
    const quote = await quoteFor(sym);
    if (!quote) return NextResponse.json({ error: "No quote available" }, { status: 404 });
    holding = { symbol: sym, name: asset.name, shares: 0, price: quote.price, changePct: quote.changePct, marketValue: 0, costBasis: 0 };
    account.holdings.push(holding);
  }

  const price = type === "limit" || type === "stop_limit" ? Number(limit_price) : holding.price;
  const filledQty = hasNotional ? Number(notional) / holding.price : Number(qty);
  const notionalUsd = hasNotional ? Number(notional) : Number(qty) * holding.price;

  // Non-market orders rest as "pending"; market fills immediately.
  const status = type === "market" ? "filled" : "pending";

  const orderId = "ord_" + crypto.randomBytes(6).toString("hex");
  let realizedGain: number | null = null;

  if (status === "filled") {
    // ---- Lot ledger: the source of truth ---------------------------------
    //
    // A buy APPENDS a lot; it never merges into an existing position. Two
    // purchases at different prices must stay distinguishable, or a later
    // split/sale cannot know what was actually paid per share.
    //
    // A sell CONSUMES lots (FIFO) and yields a realized gain. The old code
    // scaled cost basis by a fraction — average-cost with no history, which
    // makes realized gain and holding period unknowable.
    if (side === "buy") {
      account.tradeLots.push(
        recordBuy({
          id: "lot_" + crypto.randomBytes(6).toString("hex"),
          userId: account.user.id,
          symbol: sym,
          quantity: filledQty,
          costBasis: notionalUsd,
          orderId,
          provenance: "execution",
        })
      );
    } else {
      // Guard: an account hydrated from Postgres has no lots yet (see
      // storeDb.accountFromRow). Selling against an empty ledger would throw
      // "insufficient position" for a holder who genuinely owns the shares, so
      // backfill a lot from the aggregate first rather than rejecting a valid
      // order. Estimated acquisition date — see the seed-lot note in store.ts.
      if (!account.tradeLots.some((l) => l.symbol === sym && l.status === "open")) {
        if (holding.shares > 0) {
          account.tradeLots.push(
            recordBuy({
              id: "lot_backfill_" + crypto.randomBytes(4).toString("hex"),
              userId: account.user.id,
              symbol: sym,
              quantity: holding.shares,
              costBasis: holding.costBasis ?? 0,
              acquiredAt: new Date(Date.now() - 365 * 86400_000).toISOString(),
              // Reconstructed from the aggregate, not observed — same caveat
              // as the offline backfill.
              provenance: "backfill",
            })
          );
        }
      }
      try {
        const sale = recordSell(account.tradeLots, sym, filledQty, notionalUsd, "fifo");
        account.tradeLots.splice(0, account.tradeLots.length, ...sale.remaining);
        realizedGain = sale.realizedGain;
      } catch (e) {
        // applySale refuses to oversell rather than driving a position
        // negative — surface that as a 400, not a 500.
        return NextResponse.json(
          { error: (e as Error).message || "insufficient position" },
          { status: 400 }
        );
      }
    }

    // ---- Derived view ----------------------------------------------------
    // holdings[] is now a projection of the ledger, not the truth. Re-derive
    // this symbol's aggregate rather than mutating it in place.
    const projected = projectHoldings(
      account.tradeLots.filter((l) => l.symbol === sym),
      [],
      () => ({ price: holding!.price, changePct: holding!.changePct, name: holding!.name })
    );
    const next = projected.find((p) => p.symbol === sym);
    holding.shares = next?.shares ?? 0;
    holding.costBasis = next?.costBasis ?? 0;
    holding.marketValue = round2(holding.shares * holding.price);

    recordTransaction(
      account.user.id,
      newTx({
        category: "invest",
        direction: side === "buy" ? "out" : "in",
        title: `${side === "buy" ? "Bought" : "Sold"} ${holding.symbol}`,
        subtitle: `Alpaca · ${type} · ${filledQty.toFixed(3)} sh`,
        amountUsd: notionalUsd,
        status: "settled",
      })
    );
    // Buy moves cash out; sell brings cash in.
    recordMovement(side === "buy" ? "out" : "in", notionalUsd, `${side === "buy" ? "Buy" : "Sell"} ${holding.symbol}`, account.user.id);
  }

  // Confirm the lot is DURABLE before telling the client the order filled.
  //
  // persistAccount() is fire-and-forget from sync mutators, which is right for
  // most writes — a stale balance re-flushes on the next touch. A trade is not
  // most writes: the response says "filled", and the lot backing it is the tax
  // record. Measured against staging on 2026-07-19, the flush completed 991ms
  // AFTER the 200 was returned; a crash inside that window loses the lot while
  // the client believes the order executed.
  //
  // store.ts already treats signup this way ("awaited where durability must be
  // confirmed"). A filled order belongs in that same category.
  await persistAccount(account.user.id);

  return NextResponse.json({
    orderId,
    status,
    symbol: holding.symbol,
    side,
    type,
    time_in_force,
    filledQty: status === "filled" ? filledQty : 0,
    limit_price: limit_price ?? null,
    stop_price: stop_price ?? null,
    // Only meaningful on a sell: proceeds minus the cost basis of the lots the
    // sale actually consumed (FIFO). Null on buys.
    realizedGain,
  });
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
