import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "crypto";

// ---------------------------------------------------------------------------
// Trade-event ingestion.
//
// Two properties carry the whole design, and both are about events arriving
// more than once or out of sequence — which is the NORMAL case for a replayable
// at-least-once stream, not an edge case:
//
//   1. An event applied twice must not book the same shares twice.
//   2. A late event must not undo a newer one.
//
// The KV layer is a real in-memory map rather than an always-succeeding stub,
// because the interesting behaviour is what happens when the dedupe store is
// UNAVAILABLE — and a stub that cannot fail cannot show it.
// ---------------------------------------------------------------------------

const store = new Map<string, unknown>();
let kvBroken = false;

vi.mock("@/lib/kv", () => ({
  kvGet: async (key: string) => {
    if (kvBroken) throw new Error("kv down");
    return store.has(key) ? store.get(key) : null;
  },
  kvSet: async (key: string, value: unknown) => {
    if (kvBroken) throw new Error("kv down");
    store.set(key, value);
  },
  kvSetNx: async (key: string, value: unknown) => {
    if (kvBroken) throw new Error("kv down");
    if (store.has(key)) return false;
    store.set(key, value);
    return true;
  },
  kvDel: async (key: string) => {
    store.delete(key);
  },
  kvListPush: async () => {},
  kvListRange: async () => [],
}));

vi.mock("@/lib/log", () => ({
  log: { error: () => {}, warn: () => {}, info: () => {} },
}));

const { eventIdFor, ingestTradeEvent, normalizeAlpacaEvent, verifyHmac, AMENDING_EVENTS } = await import(
  "../events"
);
const { createOrderRecord, getOrderRecord } = await import("../orderStore");

const CLIENT_ORDER_ID = "fp_test_order";

async function seedOrder(status: "submitted" | "accepted" = "accepted") {
  const record = await createOrderRecord({
    clientOrderId: CLIENT_ORDER_ID,
    userId: "user_1",
    symbol: "NVDA",
    side: "buy",
    type: "market",
    timeInForce: "day",
    qty: 10,
    notional: null,
    limitPrice: null,
    stopPrice: null,
    provider: "alpaca",
    providerIsLive: true,
  });
  if (status === "accepted") {
    store.set(`order:${CLIENT_ORDER_ID}`, {
      ...record,
      status: "accepted",
      updatedAt: "2026-08-22T10:00:00.000Z",
    });
  }
  return record;
}

function alpacaFill(overrides: Record<string, unknown> = {}) {
  return {
    event: "fill",
    execution_id: "exec_1",
    at: "2026-08-22T10:00:05.000Z",
    price: "214.72",
    qty: "10",
    order: {
      id: "prov_1",
      client_order_id: CLIENT_ORDER_ID,
      symbol: "NVDA",
      status: "filled",
      filled_qty: "10",
      filled_avg_price: "214.72",
    },
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  kvBroken = false;
});

describe("eventIdFor", () => {
  it("prefers the provider's execution id", () => {
    expect(eventIdFor(alpacaFill())).toBe("exec:exec_1");
  });

  it("gives two partial fills of one order DIFFERENT ids", () => {
    // The reason execution_id comes first. Keyed on the order id, the second
    // partial would look like a replay of the first and real shares would be
    // silently dropped.
    const a = eventIdFor(alpacaFill({ execution_id: "exec_1" }));
    const b = eventIdFor(alpacaFill({ execution_id: "exec_2" }));
    expect(a).not.toBe(b);
  });

  it("falls back to a deterministic composite when there is no execution id", () => {
    const payload = alpacaFill({ execution_id: null });
    const first = eventIdFor(payload);
    const second = eventIdFor(payload);
    expect(first).toBe(second);
    expect(first).toContain("prov_1");
  });

  it("returns null when the event cannot be identified at all", () => {
    expect(eventIdFor({ event: "fill" })).toBeNull();
  });
});

describe("normalizeAlpacaEvent", () => {
  it("maps a fill onto the canonical shape", () => {
    const event = normalizeAlpacaEvent(alpacaFill());
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      provider: "alpaca",
      kind: "fill",
      status: "filled",
      clientOrderId: CLIENT_ORDER_ID,
      symbol: "NVDA",
      filledQty: 10,
      filledAvgPrice: 214.72,
      executionQty: 10,
      executionPrice: 214.72,
    });
  });

  it("maps a partial fill distinctly from a fill", () => {
    const event = normalizeAlpacaEvent(
      alpacaFill({ event: "partial_fill", order: { ...alpacaFill().order, status: "partially_filled", filled_qty: "4" } })
    );
    expect(event?.status).toBe("partially_filled");
    expect(event?.filledQty).toBe(4);
  });

  it("refuses an event with no client order id rather than guessing", () => {
    // Guessing the attribution is how a fill lands on the wrong account.
    const event = normalizeAlpacaEvent({ event: "fill", order: { id: "prov_1" } });
    expect(event).toBeNull();
  });

  it("does NOT map a busted trade to a status change", () => {
    // A bust reverses a completed execution. It needs a compensating ledger
    // entry, not a state transition — mapping it to one would quietly advance
    // an order on the strength of a reversal.
    const event = normalizeAlpacaEvent(alpacaFill({ event: "trade_bust" }));
    expect(event?.status).toBe("unknown");
    expect(AMENDING_EVENTS.has("trade_bust")).toBe(true);
    expect(AMENDING_EVENTS.has("trade_correct")).toBe(true);
  });

  it("keeps the raw payload verbatim as evidence", () => {
    const payload = alpacaFill();
    expect(normalizeAlpacaEvent(payload)?.raw).toBe(payload);
  });
});

describe("ingestTradeEvent", () => {
  it("applies a fill to a known order", async () => {
    await seedOrder();
    const event = normalizeAlpacaEvent(alpacaFill())!;
    const outcome = await ingestTradeEvent(event);
    expect(outcome.result).toBe("applied");

    const record = await getOrderRecord(CLIENT_ORDER_ID);
    expect(record?.status).toBe("filled");
    expect(record?.filledQty).toBe(10);
    expect(record?.filledAvgPrice).toBe(214.72);
  });

  it("silently ignores the SAME event delivered twice", async () => {
    // The core guarantee. Alpaca's stream is replayable by design.
    await seedOrder();
    const event = normalizeAlpacaEvent(alpacaFill())!;
    expect((await ingestTradeEvent(event)).result).toBe("applied");
    expect((await ingestTradeEvent(event)).result).toBe("duplicate");
  });

  it("dead-letters an event for an order it has never seen", async () => {
    // The provider has an order this deployment did not create. Manufacturing
    // a local record would erase the discrepancy AND invent an attribution.
    const event = normalizeAlpacaEvent(alpacaFill())!;
    const outcome = await ingestTradeEvent(event);
    expect(outcome.result).toBe("unknown_order");
    expect(store.has(`brokerage:event:dead:${event.id}`)).toBe(true);
  });

  it("refuses to apply anything when the dedupe store is unavailable", async () => {
    // Skipping an event costs a delay the reconciler closes. Applying one twice
    // costs money — so an unavailable dedupe store must fail CLOSED.
    await seedOrder();
    kvBroken = true;
    const event = normalizeAlpacaEvent(alpacaFill())!;
    expect((await ingestTradeEvent(event)).result).toBe("duplicate");
  });

  it("refuses a late event that would walk a filled order backwards", async () => {
    await seedOrder();
    await ingestTradeEvent(normalizeAlpacaEvent(alpacaFill())!);

    // An `accepted` for the same order, arriving after the fill.
    const late = normalizeAlpacaEvent(
      alpacaFill({
        event: "accepted",
        execution_id: "exec_late",
        at: "2026-08-22T10:00:01.000Z",
        order: { ...alpacaFill().order, status: "accepted", filled_qty: null, filled_avg_price: null },
      })
    )!;
    const outcome = await ingestTradeEvent(late);
    expect(outcome.result).toBe("out_of_order");

    const record = await getOrderRecord(CLIENT_ORDER_ID);
    expect(record?.status).toBe("filled");
    expect(record?.filledQty).toBe(10);
  });

  it("still applies an older event that carries a fill we do not have", async () => {
    // A late event reporting MORE filled quantity is not stale in the way that
    // matters — dropping it on a timestamp comparison would lose real shares.
    await seedOrder();
    store.set(`order:${CLIENT_ORDER_ID}`, {
      ...(store.get(`order:${CLIENT_ORDER_ID}`) as object),
      status: "partially_filled",
      filledQty: 3,
      updatedAt: "2026-08-22T10:00:09.000Z",
    });

    const older = normalizeAlpacaEvent(
      alpacaFill({
        execution_id: "exec_bigger",
        at: "2026-08-22T10:00:04.000Z",
        order: { ...alpacaFill().order, status: "partially_filled", filled_qty: "7" },
      })
    )!;
    const outcome = await ingestTradeEvent(older);
    expect(outcome.result).toBe("applied");
    expect((await getOrderRecord(CLIENT_ORDER_ID))?.filledQty).toBe(7);
  });

  it("never lets a fill quantity go backwards", async () => {
    await seedOrder();
    await ingestTradeEvent(
      normalizeAlpacaEvent(
        alpacaFill({
          execution_id: "exec_a",
          order: { ...alpacaFill().order, status: "partially_filled", filled_qty: "8" },
        })
      )!
    );
    await ingestTradeEvent(
      normalizeAlpacaEvent(
        alpacaFill({
          execution_id: "exec_b",
          at: "2026-08-22T10:00:06.000Z",
          order: { ...alpacaFill().order, status: "partially_filled", filled_qty: "5" },
        })
      )!
    );
    expect((await getOrderRecord(CLIENT_ORDER_ID))?.filledQty).toBe(8);
  });

  it("records how the order reached its status", async () => {
    await seedOrder();
    await ingestTradeEvent(normalizeAlpacaEvent(alpacaFill())!);
    const record = await getOrderRecord(CLIENT_ORDER_ID);
    expect(record?.history.at(-1)).toMatchObject({ from: "accepted", to: "filled", source: "event:fill" });
  });
});

describe("verifyHmac", () => {
  // Unused by Alpaca, which is SSE-only. Kept correct for the next provider,
  // because a verifier written under deadline is a verifier with a `==` in it.
  const secret = "shhh";
  const body = '{"event":"fill"}';

  function sign(payload: string, key = secret): string {
    return createHmac("sha256", key).update(payload).digest("hex");
  }

  it("accepts a correct signature", () => {
    const result = verifyHmac({
      rawBody: body,
      signatureHeader: sign(body),
      timestampHeader: null,
      secret,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a signature made with the wrong key", () => {
    const result = verifyHmac({
      rawBody: body,
      signatureHeader: sign(body, "wrong"),
      timestampHeader: null,
      secret,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a tampered body", () => {
    const result = verifyHmac({
      rawBody: '{"event":"fill","qty":"9999"}',
      signatureHeader: sign(body),
      timestampHeader: null,
      secret,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a stale timestamp, so a captured request cannot replay forever", () => {
    const ts = String(Math.floor(Date.now() / 1000) - 3600);
    const result = verifyHmac({
      rawBody: body,
      signatureHeader: sign(`${ts}.${body}`),
      timestampHeader: ts,
      secret,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale_timestamp");
  });

  it("accepts a fresh timestamped signature", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const result = verifyHmac({
      rawBody: body,
      signatureHeader: sign(`${ts}.${body}`),
      timestampHeader: ts,
      secret,
    });
    expect(result.ok).toBe(true);
  });

  it("does not throw on a length mismatch", () => {
    // timingSafeEqual THROWS on differing lengths; an uncaught throw here is an
    // unverified request taking down the route.
    expect(() =>
      verifyHmac({ rawBody: body, signatureHeader: "ab", timestampHeader: null, secret })
    ).not.toThrow();
  });

  it("refuses when no secret is configured", () => {
    const result = verifyHmac({ rawBody: body, signatureHeader: sign(body), timestampHeader: null, secret: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_configured");
  });
});
