import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRange } from "@/lib/analytics/range";
import { parseChain, shortRef, summarizeLedger, summarizeRisk, tokenKey, type LedgerRow } from "../dashboard";
import { summarizeMarket } from "../market";
import { __resetAlliumMemo, alliumQuery } from "../allium";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const range = (() => {
  const r = parseRange(new URLSearchParams("range=7d"), NOW);
  if (!r.ok) throw new Error(r.error);
  return r.range;
})();

const row = (p: Partial<LedgerRow>): LedgerRow => ({
  rail: "x402",
  state: "settled",
  amount_usd: 10,
  fee_usd: 0.1,
  token: "USDC",
  source_chain: null,
  dest_chain: "base",
  recipient: "0x1111111111111111111111111111111111111111",
  tx_hash: "0xabcdef0123456789abcdef0123456789",
  user_id: "u1",
  created_at: "2026-10-06T10:00:00Z",
  ...p,
});

describe("summarizeLedger", () => {
  it("counts settled rows only, with real period-over-period change", () => {
    const cur = [
      row({}),
      row({ amount_usd: "30", token: "eth", dest_chain: "arbitrum", user_id: "u2", rail: "lifi" }),
      row({ state: "failed", amount_usd: 999 }),
    ];
    const prev = [row({ amount_usd: 20, created_at: "2026-09-28T10:00:00Z" })];
    const v = summarizeLedger(range, cur, prev, "all");
    expect(v.kpis.volume.value).toBe(40);
    expect(v.kpis.volume.change).toBeCloseTo(1); // 40 vs 20
    expect(v.kpis.transactions.value).toBe(2);
    expect(v.kpis.users.value).toBe(2);
    expect(v.kpis.fees.value).toBeCloseTo(0.2);
    expect(v.chains.map((c) => c.chain)).toEqual(["arbitrum", "base"]);
    expect(v.rails[0]).toMatchObject({ rail: "lifi", volume: 30, count: 1 });
    expect(v.volumeByBucket.at(-1)!.tokens).toMatchObject({ USDC: 10, ETH: 30 });
    // The feed shows every state, newest first, with truncated hashes.
    expect(v.activity).toHaveLength(3);
    expect(v.activity[0].hash).toBe("0xabcd…6789");
  });

  it("has no change ratio when the previous period is empty (never a made-up %)", () => {
    const v = summarizeLedger(range, [row({})], [], "all");
    expect(v.kpis.volume.change).toBeNull();
  });

  it("filters by chain on either side of the movement", () => {
    const v = summarizeLedger(range, [row({ dest_chain: "base" }), row({ dest_chain: null, source_chain: "solana" })], [], "solana");
    expect(v.kpis.transactions.value).toBe(1);
  });

  it("is all zeros for an empty ledger", () => {
    const v = summarizeLedger(range, [], [], "all");
    expect(v.kpis.volume.value).toBe(0);
    expect(v.chains).toEqual([]);
    expect(v.counterparties).toEqual([]);
  });
});

describe("summarizeRisk", () => {
  it("bands severities and counts sanctions by kind", () => {
    const r = summarizeRisk(
      [
        { kind: "replay_rejected", severity: "info", created_at: "" },
        { kind: "sanctions_screen_hit", severity: "high", created_at: "" },
        { kind: "bad_signature", severity: "critical", created_at: "" },
        { kind: "amount_over_limit", severity: "medium", created_at: "" },
      ],
      [{ kind: "bad_signature", severity: "critical", created_at: "" }]
    );
    expect(r.bySeverity).toEqual({ low: 1, medium: 1, high: 2 });
    expect(r.flagged.value).toBe(3);
    expect(r.sanctions.value).toBe(1);
    expect(r.critical.value).toBe(1);
    expect(r.critical.change).toBe(0);
  });
});

describe("helpers", () => {
  it("parses chains strictly", () => {
    expect(parseChain(null)).toBe("all");
    expect(parseChain("Base")).toBe("base");
    expect(parseChain("dogechain")).toBeNull();
  });
  it("normalizes tokens and truncates refs", () => {
    expect(tokenKey("WETH")).toBe("ETH");
    expect(tokenKey("XSGD")).toBe("OTHER");
    expect(shortRef("0x1234567890abcdef")).toBe("0x1234…cdef");
    expect(shortRef(null)).toBeNull();
  });
});

describe("summarizeMarket", () => {
  const assets = {
    peggedAssets: [
      { symbol: "USDT", name: "Tether", pegType: "peggedUSD", circulating: { peggedUSD: 300 }, circulatingPrevMonth: { peggedUSD: 250 }, chainCirculating: { Ethereum: { current: { peggedUSD: 200 } }, Tron: { current: { peggedUSD: 100 } } } },
      { symbol: "USDC", name: "USD Coin", pegType: "peggedUSD", circulating: { peggedUSD: 100 }, circulatingPrevMonth: { peggedUSD: 150 }, chainCirculating: { Ethereum: { current: { peggedUSD: 100 } } } },
      { symbol: "EURC", name: "Euro Coin", pegType: "peggedEUR", circulating: { peggedEUR: 50 }, chainCirculating: {} },
    ],
  };
  const chart = [
    { date: "1790000000", totalCirculatingUSD: { peggedUSD: 390 } },
    { date: "1790086400", totalCirculatingUSD: { peggedUSD: 400 } },
  ];
  it("sums USD-pegged supply only and ranks chains", () => {
    const m = summarizeMarket(assets, chart);
    expect(m.totalSupplyUsd).toBe(400);
    expect(m.supplyChange30d).toBe(0);
    expect(m.topChains[0]).toMatchObject({ chain: "Ethereum", supplyUsd: 300 });
    expect(m.topCoins.map((c) => c.symbol)).toEqual(["USDT", "USDC"]);
    expect(m.supplySeries).toHaveLength(2);
  });
  it("refuses an empty market instead of reporting $0", () => {
    expect(() => summarizeMarket({ peggedAssets: [] }, [])).toThrow();
  });
});

describe("alliumQuery", () => {
  const env = { ...process.env };
  beforeEach(() => __resetAlliumMemo());
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("is unavailable without a key, and makes no request", async () => {
    delete process.env.ALLIUM_API_KEY;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await alliumQuery("stablecoinDaily", NOW);
    expect(r).toMatchObject({ status: "unavailable", reason: "ALLIUM_API_KEY is not set." });
    expect(f).not.toHaveBeenCalled();
  });

  it("reads the latest successful run and validates the output contract", async () => {
    process.env.ALLIUM_API_KEY = "test-key";
    process.env.ALLIUM_STABLECOIN_DAILY_QUERY_ID = "q_daily1";
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["X-API-KEY"]).toBe("test-key");
      if (url.endsWith("/api/v1/explorer/query-runs?query_id=q_daily1"))
        return Response.json({ run_id: "r1", status: "success", completed_at: "2026-10-06T06:00:00Z" });
      if (url.endsWith("/api/v1/explorer/query-runs/r1/results"))
        return Response.json({ data: [{ day: "2026-10-05", tx_count: 30800000, transfer_count: "73000000", volume_usd: "226900000000.5", sender_count: 5280000, recipient_count: 8990000 }], queried_at: "2026-10-06T06:00:00Z" });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", f);
    const r = await alliumQuery("stablecoinDaily", NOW);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.data[0]).toEqual({ day: "2026-10-05", tx_count: 30800000, transfer_count: 73000000, volume_usd: 226900000000.5, sender_count: 5280000, recipient_count: 8990000 });
    expect(f).toHaveBeenCalledTimes(2); // fresh run: no re-run requested
  });

  it("rejects rows that do not match the contract", async () => {
    process.env.ALLIUM_API_KEY = "k";
    process.env.ALLIUM_CORRIDOR_QUERY_ID = "q_corr1";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("query_id=")
          ? Response.json({ run_id: "r2", status: "success", completed_at: "2026-10-06T06:00:00Z" })
          : Response.json({ data: [{ from_country: "United States", to_country: "EU", volume_usd: 5 }] })
      )
    );
    const r = await alliumQuery("corridors", NOW);
    expect(r.status).toBe("unavailable");
  });

  it("reports an auth failure by status and requests a re-run of a stale query", async () => {
    process.env.ALLIUM_API_KEY = "k";
    process.env.ALLIUM_STABLECOIN_DAILY_QUERY_ID = "q_daily1";
    const bad = vi.fn(async () => new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", bad);
    const r = await alliumQuery("stablecoinDaily", NOW);
    expect(r).toMatchObject({ status: "unavailable", reason: "Allium responded 401 (check ALLIUM_API_KEY)" });

    __resetAlliumMemo();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("query_id=")) return Response.json({ run_id: "r3", status: "success", completed_at: "2026-10-01T00:00:00Z" });
        if (url.endsWith("/run-async")) return Response.json({ run_id: "r4" });
        return Response.json({ data: [] });
      })
    );
    const stale = await alliumQuery("stablecoinDaily", NOW);
    expect(stale.status).toBe("ok");
    expect(calls.some((u) => u.endsWith("/api/v1/explorer/queries/q_daily1/run-async"))).toBe(true);
  });
});
