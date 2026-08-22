import { describe, it, expect, beforeEach } from "vitest";
import { MarketDataEngine, changePercentOf, midOf } from "../symbolState";
import { checkEligibility, diffBoards, rank, topK } from "../movers";
import { DEFAULT_ELIGIBILITY, freshnessOf, type MarketEvent } from "../types";

// ---------------------------------------------------------------------------
// The market-data engine.
//
// Every test here corresponds to a way a real feed misbehaves. None of these
// raise an error at runtime — they silently corrupt state, and the corruption
// is indistinguishable from market movement. That is the whole reason the
// guards exist and the whole reason they are pinned.
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-08-22T14:30:00.000Z");

function trade(
  symbol: string,
  price: number,
  size: number,
  opts: Partial<Extract<MarketEvent, { type: "trade" }>> = {}
): MarketEvent {
  return {
    type: "trade",
    symbol,
    price,
    size,
    exchangeTimestamp: T0,
    receivedAt: T0 + 5,
    source: "iex",
    ...opts,
  };
}

let engine: MarketDataEngine;
beforeEach(() => {
  engine = new MarketDataEngine();
});

describe("trade application", () => {
  it("applies a trade to price and volume", () => {
    engine.apply(trade("NVDA", 200, 100));
    const s = engine.state("NVDA")!;
    expect(s.lastPrice).toBe(200);
    expect(s.volume).toBe(100);
    expect(s.dollarVolume).toBe(20_000);
  });

  it("ignores a non-positive price or size rather than storing it", () => {
    expect(engine.apply(trade("NVDA", 0, 100))).toBe("ignored");
    expect(engine.apply(trade("NVDA", 200, 0))).toBe("ignored");
    expect(engine.state("NVDA")?.lastPrice).toBeNull();
    expect(engine.state("NVDA")?.volume).toBe(0);
  });

  it("tracks the observed session range", () => {
    engine.apply(trade("NVDA", 200, 10, { exchangeTimestamp: T0 }));
    engine.apply(trade("NVDA", 210, 10, { exchangeTimestamp: T0 + 1000 }));
    engine.apply(trade("NVDA", 195, 10, { exchangeTimestamp: T0 + 2000 }));
    const s = engine.state("NVDA")!;
    expect(s.observedHigh).toBe(210);
    expect(s.observedLow).toBe(195);
  });
});

describe("deduplication", () => {
  it("drops a replayed trade by its venue id", () => {
    // The reconnect case. Applying twice double-counts the volume.
    engine.apply(trade("NVDA", 200, 100, { tradeId: "x1" }));
    expect(engine.apply(trade("NVDA", 200, 100, { tradeId: "x1" }))).toBe("duplicate");
    expect(engine.state("NVDA")!.volume).toBe(100);
    expect(engine.state("NVDA")!.duplicatesDropped).toBe(1);
  });

  it("keeps two genuine trades that differ only by id", () => {
    // Same price, same size, same millisecond — two real executions. Only the
    // venue id distinguishes them, which is why it is the dedupe key.
    engine.apply(trade("NVDA", 200, 100, { tradeId: "a" }));
    engine.apply(trade("NVDA", 200, 100, { tradeId: "b" }));
    expect(engine.state("NVDA")!.volume).toBe(200);
  });

  it("drops a message whose sequence has already been seen", () => {
    engine.apply(trade("NVDA", 200, 100, { sequence: 10 }));
    expect(engine.apply(trade("NVDA", 201, 50, { sequence: 10 }))).toBe("duplicate");
    expect(engine.apply(trade("NVDA", 201, 50, { sequence: 9 }))).toBe("duplicate");
    expect(engine.state("NVDA")!.volume).toBe(100);
  });
});

describe("ordering", () => {
  it("does not let a late print move the last price backwards", () => {
    engine.apply(trade("NVDA", 210, 10, { exchangeTimestamp: T0 + 5000 }));
    const result = engine.apply(trade("NVDA", 190, 10, { exchangeTimestamp: T0 + 1000 }));
    expect(result).toBe("out_of_order_price");
    expect(engine.state("NVDA")!.lastPrice).toBe(210);
  });

  it("STILL counts a late print toward volume", () => {
    // The asymmetry a single isNewer guard gets wrong: the shares really
    // changed hands, so the volume is real even though the price is history.
    engine.apply(trade("NVDA", 210, 10, { exchangeTimestamp: T0 + 5000 }));
    engine.apply(trade("NVDA", 190, 40, { exchangeTimestamp: T0 + 1000 }));
    expect(engine.state("NVDA")!.volume).toBe(50);
    expect(engine.state("NVDA")!.outOfOrderPrices).toBe(1);
  });

  it("ignores a stale quote", () => {
    engine.apply({
      type: "quote", symbol: "NVDA", bid: 199, ask: 201, bidSize: 1, askSize: 1,
      exchangeTimestamp: T0 + 5000, receivedAt: T0, source: "iex",
    });
    const r = engine.apply({
      type: "quote", symbol: "NVDA", bid: 150, ask: 152, bidSize: 1, askSize: 1,
      exchangeTimestamp: T0 + 1000, receivedAt: T0, source: "iex",
    });
    expect(r).toBe("out_of_order_price");
    expect(engine.state("NVDA")!.bid).toBe(199);
  });
});

describe("sequence gaps", () => {
  it("flags a gap and keeps the flag set", () => {
    engine.apply(trade("NVDA", 200, 10, { sequence: 1 }));
    expect(engine.apply(trade("NVDA", 201, 10, { sequence: 5 }))).toBe("sequence_gap");
    const s = engine.state("NVDA")!;
    expect(s.sequenceGap).toBe(true);

    // Later good messages do NOT clear it: the volume lost in the gap is gone
    // and no amount of further streaming recovers it.
    engine.apply(trade("NVDA", 202, 10, { sequence: 6 }));
    expect(engine.state("NVDA")!.sequenceGap).toBe(true);
  });

  it("clears the gap only when an authoritative snapshot arrives", () => {
    engine.apply(trade("NVDA", 200, 10, { sequence: 1 }));
    engine.apply(trade("NVDA", 201, 10, { sequence: 9 }));
    expect(engine.state("NVDA")!.sequenceGap).toBe(true);

    engine.hydrate("NVDA", { volume: 5_000_000, source: "sip" });
    expect(engine.state("NVDA")!.sequenceGap).toBe(false);
    // A snapshot REPLACES the running total; adding would double-count.
    expect(engine.state("NVDA")!.volume).toBe(5_000_000);
  });
});

describe("sale conditions", () => {
  it("does not let an average-price trade set the last price", () => {
    engine.apply(trade("NVDA", 200, 10, { exchangeTimestamp: T0 }));
    engine.apply(trade("NVDA", 999, 10, { exchangeTimestamp: T0 + 1000, conditions: ["W"] }));
    expect(engine.state("NVDA")!.lastPrice).toBe(200);
  });

  it("excludes an average-price trade from volume too", () => {
    engine.apply(trade("NVDA", 200, 100, { conditions: ["W"] }));
    expect(engine.state("NVDA")!.volume).toBe(0);
  });

  it("counts a late-reported trade toward volume but not last price", () => {
    // Condition "L" (sold last) is a real execution reported late.
    engine.apply(trade("NVDA", 200, 10, { exchangeTimestamp: T0 }));
    engine.apply(trade("NVDA", 999, 40, { exchangeTimestamp: T0 + 1000, conditions: ["L"] }));
    const s = engine.state("NVDA")!;
    expect(s.lastPrice).toBe(200);
    expect(s.volume).toBe(50);
  });

  it("does not exclude on an unrecognised condition", () => {
    // Conservative by design: dropping real prints on a code we do not
    // understand is worse than including one we should have skipped.
    engine.apply(trade("NVDA", 200, 100, { conditions: ["@", "ZZZ"] }));
    expect(engine.state("NVDA")!.lastPrice).toBe(200);
    expect(engine.state("NVDA")!.volume).toBe(100);
  });
});

describe("derived values", () => {
  it("computes percent change only when both sides are real", () => {
    engine.hydrate("NVDA", { previousClose: 200, source: "iex" });
    engine.apply(trade("NVDA", 210, 10));
    expect(changePercentOf(engine.state("NVDA")!)).toBeCloseTo(5);

    engine.hydrate("AMD", { source: "iex" });
    engine.apply(trade("AMD", 210, 10));
    expect(changePercentOf(engine.state("AMD")!)).toBeNull();
  });

  it("refuses a mid from a crossed or one-sided book", () => {
    const q = (bid: number | null, ask: number | null): MarketEvent => ({
      type: "quote", symbol: "X", bid, ask, bidSize: 1, askSize: 1,
      exchangeTimestamp: T0, receivedAt: T0, source: "iex",
    });
    engine.apply(q(199, 201));
    expect(midOf(engine.state("X")!)).toBe(200);

    // Crossed: a mid here is an artefact, not a price.
    const e2 = new MarketDataEngine();
    e2.apply({ ...(q(202, 201) as object) } as MarketEvent);
    expect(midOf(e2.state("X")!)).toBeNull();

    const e3 = new MarketDataEngine();
    e3.apply(q(199, null));
    expect(midOf(e3.state("X")!)).toBeNull();
  });
});

describe("freshness", () => {
  it("grades by exchange time, not receive time", () => {
    expect(freshnessOf(T0, T0 + 1_000)).toBe("live");
    expect(freshnessOf(T0, T0 + 60_000)).toBe("degraded");
    expect(freshnessOf(T0, T0 + 600_000)).toBe("stale");
  });

  it("treats a missing timestamp as unknown, never as fresh", () => {
    expect(freshnessOf(null, T0)).toBe("unknown");
  });

  it("treats a future timestamp as unknown rather than maximally fresh", () => {
    // A clock problem would otherwise pin a symbol at the top forever.
    expect(freshnessOf(T0 + 60_000, T0)).toBe("unknown");
  });
});

describe("eligibility", () => {
  function seeded(over: Partial<Parameters<typeof engine.hydrate>[1]> = {}) {
    const e = new MarketDataEngine();
    e.hydrate("NVDA", { previousClose: 200, source: "iex", ...over });
    e.apply(trade("NVDA", 210, 1000));
    return e.state("NVDA")!;
  }

  it("passes a live, priced, liquid symbol", () => {
    expect(checkEligibility(seeded(), T0 + 1000).ok).toBe(true);
  });

  it("excludes a stale symbol from the live board", () => {
    // The headline failure: a price that was high an hour ago sitting in Top
    // Gainers beside genuinely live rows.
    const out = checkEligibility(seeded(), T0 + 600_000);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("stale");
  });

  it("excludes a halted symbol", () => {
    const e = new MarketDataEngine();
    e.hydrate("NVDA", { previousClose: 200, source: "iex" });
    e.apply(trade("NVDA", 210, 1000));
    e.apply({ type: "status", symbol: "NVDA", status: "halted", exchangeTimestamp: T0, receivedAt: T0, source: "iex" });
    const out = checkEligibility(e.state("NVDA")!, T0 + 1000);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("halted");
  });

  it("excludes a symbol with no previous close to measure against", () => {
    const e = new MarketDataEngine();
    e.apply(trade("NVDA", 210, 100));
    expect(checkEligibility(e.state("NVDA")!, T0 + 1000).reason).toBe("no_previous_close");
  });

  it("excludes sub-dollar names by default", () => {
    // A $0.02 stock ticking to $0.03 is a 50% gainer and would own the board.
    const e = new MarketDataEngine();
    e.hydrate("PENNY", { previousClose: 0.02, source: "iex" });
    e.apply(trade("PENNY", 0.03, 100000));
    expect(checkEligibility(e.state("PENNY")!, T0 + 1000).reason).toBe("below_min_price");
  });
});

describe("topK", () => {
  const byNum = (a: number, b: number) => b - a;

  it("returns the largest K in order", () => {
    expect(topK([5, 1, 9, 3, 7], 3, byNum)).toEqual([9, 7, 5]);
  });

  it("returns everything when K exceeds the input", () => {
    expect(topK([2, 1, 3], 10, byNum)).toEqual([3, 2, 1]);
  });

  it("handles the boundary exactly — no dropped last row", () => {
    expect(topK([1, 2, 3], 3, byNum)).toEqual([3, 2, 1]);
    expect(topK([1, 2, 3], 1, byNum)).toEqual([3]);
    expect(topK([], 5, byNum)).toEqual([]);
    expect(topK([1, 2], 0, byNum)).toEqual([]);
  });

  it("agrees with a full sort", () => {
    const items = Array.from({ length: 500 }, (_, i) => (i * 7919) % 1000);
    for (const k of [1, 5, 20, 100]) {
      expect(topK(items, k, byNum)).toEqual([...items].sort(byNum).slice(0, k));
    }
  });
});

describe("ranking", () => {
  function universe(now: number) {
    const e = new MarketDataEngine();
    const rows: [string, number, number, number][] = [
      // symbol, prevClose, last, size
      ["AAA", 100, 110, 1000], // +10%
      ["BBB", 100, 105, 5000], // +5%
      ["CCC", 100, 95, 2000], // -5%
      ["DDD", 100, 80, 9000], // -20%
      ["EEE", 100, 110, 4000], // +10%, ties AAA
    ];
    for (const [sym, prev, last, size] of rows) {
      e.hydrate(sym, { previousClose: prev, source: "iex" });
      e.apply(trade(sym, last, size, { exchangeTimestamp: now - 1000 }));
    }
    return e;
  }

  it("ranks gainers by percent, descending", () => {
    const now = T0 + 10_000;
    const r = rank(universe(now).all(), "gainers", { now, limit: 3 });
    expect(r.rows.map((x) => x.symbol)).toEqual(["EEE", "AAA", "BBB"]);
    expect(r.rows[0].changePercent).toBeCloseTo(10);
  });

  it("breaks a percent tie by dollar volume, then symbol — deterministically", () => {
    // AAA and EEE are both +10%. EEE traded 4000 @ 110 vs AAA's 1000 @ 110,
    // so EEE wins on dollar volume. Running it twice must give the same answer.
    const now = T0 + 10_000;
    const a = rank(universe(now).all(), "gainers", { now, limit: 5 }).rows.map((x) => x.symbol);
    const b = rank(universe(now).all(), "gainers", { now, limit: 5 }).rows.map((x) => x.symbol);
    expect(a).toEqual(b);
    expect(a.slice(0, 2)).toEqual(["EEE", "AAA"]);
  });

  it("ranks losers by percent, ascending", () => {
    const now = T0 + 10_000;
    const r = rank(universe(now).all(), "losers", { now, limit: 2 });
    expect(r.rows.map((x) => x.symbol)).toEqual(["DDD", "CCC"]);
  });

  it("reports WHY symbols were excluded", () => {
    const now = T0 + 10_000;
    const e = universe(now);
    // Two different gaps, and eligibility reports the most fundamental one
    // first: a symbol with neither a price nor a previous close is "no_price",
    // because that is the more useful thing to tell someone debugging.
    e.hydrate("ZZZ", { source: "iex" });
    e.hydrate("YYY", { source: "iex" });
    e.apply(trade("YYY", 50, 100, { exchangeTimestamp: now - 1000 }));
    const r = rank(e.all(), "gainers", { now });
    expect(r.excluded.no_price).toBe(1);
    expect(r.excluded.no_previous_close).toBe(1);
    expect(r.eligible).toBe(5);
    expect(r.universe).toBe(7);
  });

  it("REFUSES a volume board built on single-venue volume", () => {
    // IEX is 1.97%-3.50% of consolidated volume and the share varies by
    // symbol, so it cannot even be scaled. Ranking by it answers a different
    // question wearing the same label.
    const now = T0 + 10_000;
    const r = rank(universe(now).all(), "most_active_volume", { now });
    expect(r.rows).toEqual([]);
    expect(r.unavailable?.reason).toBe("volume_not_consolidated");
  });

  it("allows a volume board when the volume IS consolidated", () => {
    const now = T0 + 10_000;
    const e = new MarketDataEngine();
    for (const [sym, vol] of [["AAA", 1000], ["BBB", 9000]] as const) {
      e.hydrate(sym, { previousClose: 100, source: "sip" });
      e.apply({ ...trade(sym, 110, vol, { exchangeTimestamp: now - 1000 }), source: "sip" });
    }
    const r = rank(e.all(), "most_active_volume", { now });
    expect(r.unavailable).toBeNull();
    expect(r.rows[0].symbol).toBe("BBB");
  });

  it("keeps a stale symbol off the board even when it was the top gainer", () => {
    const now = T0 + 10_000;
    const e = universe(now);
    // A symbol whose NEWEST event is hours old. Note that applying a fresh
    // trade carrying an old timestamp would NOT do this — `maxTs` keeps the
    // newest exchange time, so a late print cannot make a live symbol look
    // stale. That asymmetry is deliberate and is why this is set up directly.
    e.hydrate("OLD", { previousClose: 100, source: "iex" });
    e.apply(trade("OLD", 130, 5000, { exchangeTimestamp: now - 3_600_000 }));
    const r = rank(e.all(), "gainers", { now, limit: 5 });
    // OLD is +30% — it would top the board on percent alone. It is excluded
    // because its price is an hour old, which is the whole point.
    expect(r.rows.map((x) => x.symbol)).not.toContain("OLD");
    expect(r.rows[0].symbol).toBe("EEE");
    expect(r.excluded.stale).toBe(1);
  });

  it("marks a row incomplete when its state has a sequence gap", () => {
    const now = T0 + 10_000;
    const e = new MarketDataEngine();
    e.hydrate("AAA", { previousClose: 100, source: "iex" });
    e.apply(trade("AAA", 110, 100, { sequence: 1, exchangeTimestamp: now - 1000 }));
    e.apply(trade("AAA", 111, 100, { sequence: 8, exchangeTimestamp: now - 500 }));
    const r = rank(e.all(), "gainers", { now });
    expect(r.rows[0].incomplete).toBe(true);
  });
});

describe("board deltas", () => {
  const row = (symbol: string, rank: number, price: number) =>
    ({
      rank, symbol, price, previousClose: 100, change: price - 100,
      changePercent: price - 100, volume: 1, dollarVolume: price,
      freshness: "live" as const, incomplete: false, asOf: T0,
    });

  it("reports only what changed", () => {
    const before = [row("AAA", 1, 110), row("BBB", 2, 105)];
    const after = [row("CCC", 1, 120), row("AAA", 2, 110)];
    const d = diffBoards(before, after, "gainers", T0);

    expect(d.entered.map((r) => r.symbol)).toEqual(["CCC"]);
    expect(d.left).toEqual(["BBB"]);
    expect(d.moved.map((r) => r.symbol)).toEqual(["AAA"]);
  });

  it("emits nothing when nothing changed", () => {
    const board = [row("AAA", 1, 110)];
    const d = diffBoards(board, board, "gainers", T0);
    expect(d.entered).toEqual([]);
    expect(d.left).toEqual([]);
    expect(d.moved).toEqual([]);
    expect(d.updated).toEqual([]);
  });

  it("reports a price move at an unchanged rank as an update", () => {
    const d = diffBoards([row("AAA", 1, 110)], [row("AAA", 1, 112)], "gainers", T0);
    expect(d.moved).toEqual([]);
    expect(d.updated.map((r) => r.symbol)).toEqual(["AAA"]);
  });
});

describe("determinism", () => {
  it("produces an identical board from an identical event sequence", () => {
    // The replay property: same events in, same leaderboard out, every time.
    const events: MarketEvent[] = [];
    for (let i = 0; i < 200; i++) {
      const sym = `S${i % 25}`;
      events.push(trade(sym, 100 + ((i * 37) % 40), 10 + (i % 7), {
        exchangeTimestamp: T0 + i * 10,
        sequence: undefined,
        tradeId: `t${i}`,
      }));
    }
    const run = () => {
      const e = new MarketDataEngine();
      for (let i = 0; i < 25; i++) e.hydrate(`S${i}`, { previousClose: 100, source: "iex" });
      for (const ev of events) e.apply(ev);
      return rank(e.all(), "gainers", { now: T0 + 5000, limit: 10 }).rows;
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual(run());
  });
});
