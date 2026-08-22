// ---------------------------------------------------------------------------
// The development simulator.
//
// THIS FILE IS UNREACHABLE IN PRODUCTION, and that is enforced in its
// constructor rather than by the caller. A guard the caller owns is a guard
// somebody eventually forgets to write; a guard the class owns fails the same
// way every time, including from a code path nobody has thought about yet.
//
// It also refuses to impersonate a real venue. `isLive` is false, `name` says
// "simulator", and every order it returns carries a `sim_` provider id, so a
// fill from here cannot be mistaken for a fill from a market in a log, in the
// ops console, or in the ledger's provenance column.
//
// What it deliberately does NOT do: fabricate prices. A simulated market order
// fills at the quote the real market-data pipeline returned, and when no quote
// is available it REJECTS rather than inventing one. A simulator that makes up
// fill prices trains everyone downstream to trust a number that has no source.
// ---------------------------------------------------------------------------

import { financialEnvironment } from "@/lib/flags";
import {
  BrokerageRejectedError,
  type BrokerageAccount,
  type BrokerageOrder,
  type BrokeragePosition,
  type BrokerageProvider,
  type BrokerageQuote,
  type PlaceOrderInput,
} from "./types";

/** Resolves a symbol to a real market price, or null. Injected so the
 *  simulator has no market-data opinions of its own. */
export type QuoteResolver = (symbol: string) => Promise<number | null>;

interface SimState {
  orders: Map<string, BrokerageOrder>;
  positions: Map<string, { qty: number; costBasis: number }>;
}

// Per-process, like every other dev-only store in this codebase.
const g = globalThis as unknown as { __furlpaySimBroker?: SimState };
const state = (): SimState =>
  (g.__furlpaySimBroker ??= { orders: new Map(), positions: new Map() });

export class SimulatedBrokerageProvider implements BrokerageProvider {
  readonly name = "simulator";
  readonly isLive = false;
  private readonly quoteFor: QuoteResolver;

  constructor(quoteFor: QuoteResolver) {
    if (financialEnvironment() === "production") {
      // Loud, immediate, and impossible to route around. A simulator reached in
      // production means a real user is about to be shown a fill that never
      // happened, which is worse than any outage.
      throw new Error(
        "SimulatedBrokerageProvider was constructed in the production environment. " +
          "This is a configuration failure: enable BROKERAGE_LIVE with real credentials, " +
          "or leave brokerage features disabled. It must never fall back to simulation."
      );
    }
    this.quoteFor = quoteFor;
  }

  async getAccount(): Promise<BrokerageAccount> {
    return {
      accountId: "sim-account",
      status: "ACTIVE",
      // Null, not a generous invented number. A simulator that reports
      // $100,000 of buying power lets a buying-power check pass in development
      // and fail for the first real user.
      buyingPower: null,
      cash: null,
      settledCash: null,
      currency: "USD",
      restrictions: ["simulated_account"],
      tradingBlocked: false,
      transfersBlocked: true,
    };
  }

  async getPositions(): Promise<BrokeragePosition[]> {
    return [...state().positions.entries()].map(([symbol, p]) => ({
      symbol,
      qty: p.qty,
      avgEntryPrice: p.qty > 0 ? p.costBasis / p.qty : null,
      marketValue: null,
      costBasis: p.costBasis,
      unrealizedPl: null,
    }));
  }

  async getOrders(opts: { status?: "open" | "closed" | "all"; limit?: number } = {}): Promise<BrokerageOrder[]> {
    const all = [...state().orders.values()];
    const wanted =
      opts.status === "open"
        ? all.filter((o) => o.status === "accepted" || o.status === "partially_filled")
        : opts.status === "closed"
          ? all.filter((o) => o.status === "filled" || o.status === "canceled" || o.status === "rejected")
          : all;
    return wanted.slice(0, opts.limit ?? 100);
  }

  async getOrder(ref: { clientOrderId?: string; providerOrderId?: string }): Promise<BrokerageOrder | null> {
    if (ref.clientOrderId) return state().orders.get(ref.clientOrderId) ?? null;
    if (ref.providerOrderId) {
      return [...state().orders.values()].find((o) => o.providerOrderId === ref.providerOrderId) ?? null;
    }
    return null;
  }

  async placeOrder(input: PlaceOrderInput): Promise<BrokerageOrder> {
    // Same idempotency contract as the real adapter, so the code path that
    // handles a duplicate is exercised in development rather than first meeting
    // production.
    const existing = state().orders.get(input.clientOrderId);
    if (existing) return existing;

    const price = await this.quoteFor(input.symbol);
    if (price == null || price <= 0) {
      // The one thing a simulator must never do.
      throw new BrokerageRejectedError(
        `No market price available for ${input.symbol}; the simulator will not invent a fill price.`,
        422
      );
    }

    const qty = input.qty ?? (input.notional != null ? input.notional / price : null);
    if (qty == null || qty <= 0) throw new BrokerageRejectedError("Order size resolved to zero", 400);

    const now = new Date().toISOString();
    // Only market orders fill here. A resting limit order in a simulator with
    // no matching engine would need a fabricated future to ever execute.
    const fills = input.type === "market";

    const order: BrokerageOrder = {
      clientOrderId: input.clientOrderId,
      providerOrderId: `sim_${input.clientOrderId}`,
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      type: input.type,
      timeInForce: input.timeInForce,
      status: fills ? "filled" : "accepted",
      qty: input.qty ?? null,
      notional: input.notional ?? null,
      limitPrice: input.limitPrice ?? null,
      stopPrice: input.stopPrice ?? null,
      filledQty: fills ? qty : null,
      filledAvgPrice: fills ? price : null,
      submittedAt: now,
      filledAt: fills ? now : null,
      canceledAt: null,
      expiredAt: null,
      rejectReason: null,
      raw: { simulated: true },
    };

    state().orders.set(order.clientOrderId, order);

    if (fills) {
      const pos = state().positions.get(order.symbol) ?? { qty: 0, costBasis: 0 };
      const signed = input.side === "buy" ? qty : -qty;
      pos.qty += signed;
      pos.costBasis += signed * price;
      if (pos.qty <= 1e-9) state().positions.delete(order.symbol);
      else state().positions.set(order.symbol, pos);
    }

    return order;
  }

  async cancelOrder(providerOrderId: string): Promise<void> {
    const order = [...state().orders.values()].find((o) => o.providerOrderId === providerOrderId);
    if (!order) return;
    if (order.status === "filled") return; // already terminal
    order.status = "canceled";
    order.canceledAt = new Date().toISOString();
  }

  async replaceOrder(
    providerOrderId: string,
    patch: { qty?: number; limitPrice?: number; stopPrice?: number }
  ): Promise<BrokerageOrder> {
    const order = [...state().orders.values()].find((o) => o.providerOrderId === providerOrderId);
    if (!order) throw new BrokerageRejectedError("Order not found", 404);
    if (patch.qty != null) order.qty = patch.qty;
    if (patch.limitPrice != null) order.limitPrice = patch.limitPrice;
    if (patch.stopPrice != null) order.stopPrice = patch.stopPrice;
    return order;
  }

  async getQuote(symbol: string): Promise<BrokerageQuote | null> {
    const price = await this.quoteFor(symbol);
    if (price == null) return null;
    // No invented spread. The simulator reports the one real number it has and
    // leaves bid and ask null rather than manufacturing a book around it.
    return { symbol: symbol.toUpperCase(), bid: null, ask: null, last: price, timestamp: null };
  }
}

/** Test seam: forget every simulated order and position. */
export function __resetSimulator(): void {
  g.__furlpaySimBroker = { orders: new Map(), positions: new Map() };
}
