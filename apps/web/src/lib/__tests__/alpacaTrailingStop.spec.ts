import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AlpacaBrokerageProvider } from "@/lib/brokerage/alpaca";
import { BrokerageRejectedError } from "@/lib/brokerage/types";

// ---------------------------------------------------------------------------
// Trailing stops through the Alpaca adapter.
//
// CONTEXT WORTH RECORDING, because it contradicts the brief this came from. The
// report that requested this work listed limit, stop and stop-limit orders as
// "not implemented" and scoped them as 4 weeks of P0 work. They were already
// wired end to end — OrderSchema accepted them, the route read them, and the
// adapter put them in the request body. The single real gap in the ORDER STACK
// was one hardcoded line of UI, plus `trailing_stop`, which is what this file
// covers.
//
// The tests assert local REFUSALS as much as the happy path, because every
// refusal here replaces a provider 422 whose body says little, arriving after a
// round trip, against an order row already written in a terminal state.
// ---------------------------------------------------------------------------

const provider = new AlpacaBrokerageProvider({
  keyId: "test-key",
  secretKey: "test-secret",
  baseUrl: "https://paper-api.alpaca.markets",
  isLive: false,
});

const BASE = {
  clientOrderId: "cli_trail_1",
  symbol: "AAPL",
  side: "sell" as const,
  type: "trailing_stop" as const,
  timeInForce: "gtc" as const,
  qty: 10,
};

/** Captures the body the adapter would send, without a network. */
let sentBody: Record<string, unknown> | null = null;

beforeEach(() => {
  sentBody = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "alp_1",
          client_order_id: BASE.clientOrderId,
          symbol: "AAPL",
          side: "sell",
          order_type: "trailing_stop",
          time_in_force: "gtc",
          status: "new",
          qty: "10",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("a valid trailing stop reaches the provider", () => {
  it("sends trail_percent in Alpaca's field name", async () => {
    await provider.placeOrder({ ...BASE, trailPercent: 5 });
    expect(sentBody).toMatchObject({
      symbol: "AAPL",
      side: "sell",
      type: "trailing_stop",
      time_in_force: "gtc",
      trail_percent: "5",
    });
    // Mutually exclusive: the other field must be absent, not null or empty.
    expect(sentBody).not.toHaveProperty("trail_price");
  });

  it("sends trail_price in Alpaca's field name", async () => {
    await provider.placeOrder({ ...BASE, trailPrice: 2.5 });
    expect(sentBody).toMatchObject({ trail_price: "2.5" });
    expect(sentBody).not.toHaveProperty("trail_percent");
  });

  it("serialises the trail as a STRING, like every other numeric field", async () => {
    // Alpaca's API takes decimals as strings. A JSON number would round-trip
    // through a float and can change the value the venue records.
    await provider.placeOrder({ ...BASE, trailPercent: 0.5 });
    expect(typeof sentBody!.trail_percent).toBe("string");
  });
});

describe("refusals that would otherwise be an opaque provider 422", () => {
  it("REFUSES a trailing stop with NEITHER trail field", async () => {
    await expect(provider.placeOrder({ ...BASE })).rejects.toThrow(/exactly one of/);
    expect(fetch, "nothing should be sent").not.toHaveBeenCalled();
  });

  it("REFUSES a trailing stop with BOTH trail fields", async () => {
    await expect(
      provider.placeOrder({ ...BASE, trailPercent: 5, trailPrice: 2.5 })
    ).rejects.toThrow(/exactly one of/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("REFUSES a trail on an order type that has no use for one", async () => {
    // Silently dropping it would place a plain market order while the caller
    // believed they had attached a trailing stop.
    await expect(
      provider.placeOrder({ ...BASE, type: "market", trailPercent: 5 })
    ).rejects.toThrow(/apply only to a trailing_stop/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("REFUSES a trailPercent of 0 or >= 100", async () => {
    // 0 triggers instantly; 100 can never trigger on a long. Both are
    // arithmetically valid and behaviourally useless.
    await expect(provider.placeOrder({ ...BASE, trailPercent: 0 })).rejects.toThrow(
      BrokerageRejectedError
    );
    await expect(provider.placeOrder({ ...BASE, trailPercent: 100 })).rejects.toThrow(/between 0 and 100/);
  });

  it("REFUSES a negative trailPrice", async () => {
    await expect(provider.placeOrder({ ...BASE, trailPrice: -1 })).rejects.toThrow(/must be positive/);
  });

  it("REFUSES a `day` time-in-force, which would expire the protection", async () => {
    // The subtle one, and the reason it is worth a check rather than a comment. A
    // trailing stop with `day` silently stops protecting the position at the
    // close — the opposite of what attaching one asks for. It is not a provider
    // error; Alpaca would accept it.
    await expect(
      provider.placeOrder({ ...BASE, timeInForce: "day", trailPercent: 5 })
    ).rejects.toThrow(/removes the protection it exists to provide/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the other order types still work unchanged", () => {
  it("leaves a limit order's body untouched", async () => {
    await provider.placeOrder({
      clientOrderId: "cli_limit_1",
      symbol: "AAPL",
      side: "buy",
      type: "limit",
      timeInForce: "gtc",
      qty: 10,
      limitPrice: 150.25,
    });
    expect(sentBody).toMatchObject({ type: "limit", limit_price: "150.25" });
    expect(sentBody).not.toHaveProperty("trail_percent");
    expect(sentBody).not.toHaveProperty("trail_price");
  });

  it("still requires exactly one of qty or notional", async () => {
    await expect(
      provider.placeOrder({ ...BASE, trailPercent: 5, notional: 1000 })
    ).rejects.toThrow(/exactly one of qty or notional/);
  });
});
