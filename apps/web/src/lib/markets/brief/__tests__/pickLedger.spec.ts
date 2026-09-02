import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// A scoreboard is only worth keeping if it can report a loss. These tests are
// mostly about the ways a track record quietly flatters itself: overwriting a
// bad board, dropping names that stopped pricing, and letting one enormous
// winner speak for the whole list.
// ---------------------------------------------------------------------------

const store = new Map<string, unknown>();
vi.mock("@/lib/kv", () => ({
  kvGet: async (k: string) => (store.has(k) ? store.get(k) : null),
  kvSet: async (k: string, v: unknown) => { store.set(k, v); },
}));

const { recordPicks, previousEntry, scoreBoard, disclaimer } = await import("../pickLedger");

const entry = (sessionDate: string, picks: [string, number, number][]) => ({
  sessionDate,
  publishedAt: Date.parse(sessionDate + "T21:30:00Z"),
  picks: picks.map(([symbol, referencePrice, score]) => ({
    symbol, referencePrice, score, changePercentThatDay: 0,
  })),
});

beforeEach(() => store.clear());

describe("recording a board", () => {
  it("writes a session once", async () => {
    expect(await recordPicks(entry("2026-09-01", [["AAA", 10, 100]]))).toBe("written");
  });

  it("refuses to overwrite what was already published", async () => {
    // A retry or a manual re-run must not replace the morning's board with the
    // afternoon's. Readers saw the first one.
    await recordPicks(entry("2026-09-01", [["AAA", 10, 100]]));
    const second = await recordPicks(entry("2026-09-01", [["ZZZ", 99, 100]]));
    expect(second).toBe("already-recorded");
    const kept = await previousEntry("2026-09-02");
    expect(kept!.picks[0]!.symbol).toBe("AAA");
  });
});

describe("finding the previous board", () => {
  it("returns the most recent board strictly before the date", async () => {
    await recordPicks(entry("2026-08-28", [["OLD", 1, 50]]));
    await recordPicks(entry("2026-09-01", [["NEW", 2, 60]]));
    const prev = await previousEntry("2026-09-02");
    expect(prev!.sessionDate).toBe("2026-09-01");
  });

  it("never returns the board for the day being published", async () => {
    // Scoring today's board against today's prices is a zero return dressed up
    // as a result.
    await recordPicks(entry("2026-09-02", [["TODAY", 5, 70]]));
    expect(await previousEntry("2026-09-02")).toBeNull();
  });

  it("skips a board whose entry has expired rather than reporting nothing", async () => {
    await recordPicks(entry("2026-08-28", [["OLD", 1, 50]]));
    await recordPicks(entry("2026-09-01", [["NEW", 2, 60]]));
    store.delete("brief:picks:2026-09-01"); // expired
    const prev = await previousEntry("2026-09-02");
    expect(prev!.sessionDate).toBe("2026-08-28");
  });
});

describe("scoring a board", () => {
  const board = entry("2026-09-01", [
    ["WIN", 100, 100],
    ["LOSE", 50, 90],
    ["FLAT", 20, 80],
  ]);
  const asOf = new Date("2026-09-03T00:00:00Z");

  it("measures each name from the price that was printed", () => {
    const prices: Record<string, number> = { WIN: 110, LOSE: 45, FLAT: 20 };
    const out = scoreBoard(board, (s) => prices[s] ?? null, asOf);
    expect(out.outcomes[0]!.returnPct).toBeCloseTo(10, 9);
    expect(out.outcomes[1]!.returnPct).toBeCloseTo(-10, 9);
    expect(out.outcomes[2]!.returnPct).toBeCloseTo(0, 9);
  });

  it("counts a flat name as not a winner", () => {
    const prices: Record<string, number> = { WIN: 110, LOSE: 45, FLAT: 20 };
    const out = scoreBoard(board, (s) => prices[s] ?? null, asOf);
    expect(out.winners).toBe(1);
    expect(out.priced).toBe(3);
  });

  it("reports a losing board as losing", () => {
    // The test that matters: this must be capable of saying the picks failed.
    const prices: Record<string, number> = { WIN: 80, LOSE: 40, FLAT: 15 };
    const out = scoreBoard(board, (s) => prices[s] ?? null, asOf);
    expect(out.winners).toBe(0);
    expect(out.meanReturnPct!).toBeLessThan(0);
    expect(out.medianReturnPct!).toBeLessThan(0);
  });

  it("keeps an unpriceable name visible instead of dropping it", () => {
    // Silently excluding a delisted or halted name is survivorship bias in its
    // smallest form: the average improves because the worst outcome vanished.
    const out = scoreBoard(board, (s) => (s === "LOSE" ? null : 100), asOf);
    expect(out.outcomes).toHaveLength(3);
    expect(out.outcomes[1]!.returnPct).toBeNull();
    expect(out.priced).toBe(2);
  });

  it("reports a median beside the mean, because one winner distorts the mean", () => {
    // A five-name board with one +129% and four flat has a mean near +26% and a
    // median of 0. Only one of those describes the board.
    const wide = entry("2026-09-01", [
      ["MOON", 10, 100], ["A", 10, 90], ["B", 10, 80], ["C", 10, 70], ["D", 10, 60],
    ]);
    const prices: Record<string, number> = { MOON: 22.9, A: 10, B: 10, C: 10, D: 10 };
    const out = scoreBoard(wide, (s) => prices[s] ?? null, asOf);
    expect(out.meanReturnPct!).toBeGreaterThan(20);
    expect(out.medianReturnPct!).toBeCloseTo(0, 9);
  });

  it("has no averages at all when nothing can be priced", () => {
    const out = scoreBoard(board, () => null, asOf);
    expect(out.priced).toBe(0);
    expect(out.winners).toBeNull();
    expect(out.meanReturnPct).toBeNull();
    expect(out.medianReturnPct).toBeNull();
  });

  it("counts elapsed time in calendar days and says so", () => {
    const out = scoreBoard(board, () => 100, asOf);
    expect(out.calendarDaysElapsed).toBe(2);
  });
});

describe("the disclaimer", () => {
  it("refuses to call the printed price an entry", () => {
    // The board publishes after the session; nobody transacted at that print.
    const d = disclaimer();
    expect(d).toMatch(/not an entry price/i);
    expect(d).toMatch(/next open/i);
    expect(d).toMatch(/before costs/i);
  });
});
