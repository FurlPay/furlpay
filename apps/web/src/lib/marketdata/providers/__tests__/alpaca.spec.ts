import { describe, it, expect } from "vitest";
import {
  MAX_STREAM_SYMBOLS,
  normalizeStreamMessage,
  reconnectDelayMs,
  subscribeFrame,
} from "../alpaca";

// ---------------------------------------------------------------------------
// The Alpaca adapter.
//
// Message shapes here are the ones the live API actually returns, verified
// against this deployment's own keys on 2026-08-22 rather than copied from
// documentation.
// ---------------------------------------------------------------------------

const RECEIVED = Date.parse("2026-08-22T14:30:00.500Z");

describe("stream normalisation", () => {
  it("maps a trade, preserving the venue timestamp", () => {
    const e = normalizeStreamMessage(
      { T: "t", S: "NVDA", p: 214.74, s: 100, i: 991, t: "2026-08-22T14:30:00.000Z", c: ["@"] },
      "iex",
      RECEIVED
    );
    expect(e).toMatchObject({
      type: "trade",
      symbol: "NVDA",
      price: 214.74,
      size: 100,
      source: "iex",
      conditions: ["@"],
    });
    // Freshness is judged on the EXCHANGE time, so it must survive intact.
    expect(e?.exchangeTimestamp).toBe(Date.parse("2026-08-22T14:30:00.000Z"));
    expect(e?.receivedAt).toBe(RECEIVED);
  });

  it("namespaces the trade id by symbol", () => {
    // Alpaca's trade id is unique per symbol per day, not globally. Unprefixed,
    // two symbols sharing an id would dedupe each other's trades away.
    const a = normalizeStreamMessage({ T: "t", S: "NVDA", p: 1, s: 1, i: 7 }, "iex");
    const b = normalizeStreamMessage({ T: "t", S: "AAPL", p: 1, s: 1, i: 7 }, "iex");
    expect((a as { tradeId?: string }).tradeId).toBe("NVDA:7");
    expect((b as { tradeId?: string }).tradeId).toBe("AAPL:7");
  });

  it("maps a quote", () => {
    const e = normalizeStreamMessage(
      { T: "q", S: "NVDA", bp: 214.7, ap: 214.8, bs: 3, as: 5, t: "2026-08-22T14:30:00.000Z" },
      "iex",
      RECEIVED
    );
    expect(e).toMatchObject({ type: "quote", bid: 214.7, ask: 214.8, bidSize: 3, askSize: 5 });
  });

  it("maps a halt status", () => {
    const e = normalizeStreamMessage(
      { T: "s", S: "NVDA", sc: "H", sm: "Volatility pause", t: "2026-08-22T14:30:00.000Z" },
      "iex"
    );
    expect(e).toMatchObject({ type: "status", status: "halted", reason: "Volatility pause" });
  });

  it("returns null for control frames rather than turning them into events", () => {
    // Subscription acks and errors are not market data. Letting them through
    // as events would put non-trades into the trade path.
    expect(normalizeStreamMessage({ T: "success", msg: "authenticated" }, "iex")).toBeNull();
    expect(normalizeStreamMessage({ T: "error", code: 401, msg: "auth failed" }, "iex")).toBeNull();
    expect(normalizeStreamMessage({ T: "subscription", trades: ["NVDA"] }, "iex")).toBeNull();
  });

  it("returns null for a malformed or partial message", () => {
    expect(normalizeStreamMessage(null, "iex")).toBeNull();
    expect(normalizeStreamMessage({ T: "t" }, "iex")).toBeNull(); // no symbol
    expect(normalizeStreamMessage({ T: "t", S: "NVDA" }, "iex")).toBeNull(); // no price/size
    expect(normalizeStreamMessage({ T: "s", S: "NVDA", sc: "??" }, "iex")).toBeNull();
  });

  it("carries a null timestamp through rather than substituting now()", () => {
    // A message with no venue time cannot be judged for freshness. Filling in
    // the receive time would make an unstamped feed look permanently live.
    const e = normalizeStreamMessage({ T: "t", S: "NVDA", p: 1, s: 1 }, "iex", RECEIVED);
    expect(e?.exchangeTimestamp).toBeNull();
  });

  it("records the feed on every event", () => {
    // The ranking engine reads this to decide whether volume is consolidated.
    const iex = normalizeStreamMessage({ T: "t", S: "NVDA", p: 1, s: 1 }, "iex");
    const sip = normalizeStreamMessage({ T: "t", S: "NVDA", p: 1, s: 1 }, "sip");
    expect(iex?.source).toBe("iex");
    expect(sip?.source).toBe("sip");
  });
});

describe("subscription cap", () => {
  it("builds a frame within the cap", () => {
    const frame = JSON.parse(subscribeFrame(["NVDA", "AAPL"]));
    expect(frame).toMatchObject({
      action: "subscribe",
      trades: ["NVDA", "AAPL"],
      quotes: ["NVDA", "AAPL"],
    });
  });

  it("refuses to build a frame the server would reject", () => {
    // A rejected subscribe leaves the socket connected and silent, which looks
    // exactly like a market with no activity. Failing here is louder.
    const tooMany = Array.from({ length: MAX_STREAM_SYMBOLS + 1 }, (_, i) => `S${i}`);
    expect(() => subscribeFrame(tooMany)).toThrow(/caps trades\/quotes at 30/);
  });

  it("accepts exactly the cap", () => {
    const exact = Array.from({ length: MAX_STREAM_SYMBOLS }, (_, i) => `S${i}`);
    expect(() => subscribeFrame(exact)).not.toThrow();
  });
});

describe("reconnect backoff", () => {
  it("grows with the attempt count", () => {
    // Full jitter, so compare the ceilings rather than the samples.
    const ceiling = (n: number) => reconnectDelayMs(n, () => 1);
    expect(ceiling(0)).toBe(1_000);
    expect(ceiling(1)).toBe(2_000);
    expect(ceiling(3)).toBe(8_000);
    expect(ceiling(5)).toBe(30_000);
  });

  it("caps so a long outage does not push retries into the hours", () => {
    expect(reconnectDelayMs(50, () => 1)).toBe(30_000);
  });

  it("applies full jitter", () => {
    // Without jitter every client of a restarted provider reconnects on the
    // same schedule and recreates the load that took it down.
    expect(reconnectDelayMs(5, () => 0)).toBe(0);
    expect(reconnectDelayMs(5, () => 0.5)).toBe(15_000);
    expect(reconnectDelayMs(5, () => 1)).toBe(30_000);
  });
});
