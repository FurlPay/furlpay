import { describe, expect, it } from "vitest";
import { chainHealth, type IndexerRow, type IssueRow } from "../usdcHealth";
import { summarizeHistory, type SeriesRow, type SupplyRow } from "../usdcHistory";
import type { UsdcChain } from "../usdcNetwork";

const live = (over: Partial<UsdcChain> = {}): UsdcChain => ({
  chain: "base",
  status: "ok",
  reason: null,
  token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  explorer: null,
  decimals: 6,
  latestBlock: 1000,
  finalizedBlock: 900,
  headAgeSeconds: 2,
  supply: { latest: "10", finalized: "10" },
  window: null,
  windowReason: null,
  rpcLatencyMs: 20,
  readAt: new Date().toISOString(),
  ...over,
});
const idx = (over: Partial<IndexerRow> = {}): IndexerRow => ({
  indexer: "asset",
  chain: "base",
  asset: "usdc",
  head_block: 1000,
  head_time: new Date().toISOString(),
  finalized_block: 900,
  indexed_block: 900,
  indexed_time: new Date(Date.now() - 900_000).toISOString(),
  last_ok_at: new Date().toISOString(),
  last_error_at: null,
  last_error: null,
  last_duration_ms: 50,
  detail: {},
  ...over,
});
const store = (over: Partial<Parameters<typeof chainHealth>[1]> = {}) => ({ asset: idx(), wallet: null, commit: { chain: "base", to_block: 900, to_time: "x", reconciled: true, duration_ms: 812, committed_at: "y" }, issues: [] as IssueRow[], available: true, reason: null, ...over });

describe("chainHealth: explicit states, never a misleading zero", () => {
  it("NOT_CONFIGURED and UNAVAILABLE carry the real reason", () => {
    expect(chainHealth(live({ status: "not_configured", reason: "No RPC URL for base (BASE_RPC_URL)." }), store())).toMatchObject({ state: "NOT_CONFIGURED", reasons: ["No RPC URL for base (BASE_RPC_URL)."] });
    expect(chainHealth(live({ status: "unavailable", reason: "node responded 503" }), store())).toMatchObject({ state: "UNAVAILABLE", reasons: ["node responded 503"] });
  });
  it("LIVE when indexed through the node's finalized block; lag and processing latency reported", () => {
    const h = chainHealth(live(), store());
    expect(h.state).toBe("LIVE");
    expect(h).toMatchObject({ indexedBlock: 900, lagBlocks: 100, blockProcessingMs: 812, supplyReconciled: true });
    expect(h.lagSeconds).toBeGreaterThanOrEqual(898);
  });
  it("INDEXING when behind finalized by more than 10 minutes", () => {
    const h = chainHealth(live(), store({ asset: idx({ indexed_block: 500, finalized_block: 900, indexed_time: new Date(Date.now() - 3_600_000).toISOString() }) }));
    expect(h.state).toBe("INDEXING");
    expect(h.reasons[0]).toMatch(/500 blocks behind/);
  });
  it("DEGRADED: failing indexer, not indexed, stale head, or an open integrity issue", () => {
    expect(chainHealth(live(), store({ asset: idx({ last_error_at: new Date(Date.now() + 1000).toISOString(), last_error: "commit refused: block_gap" }) })).state).toBe("DEGRADED");
    expect(chainHealth(live(), store({ asset: null })).reasons[0]).toMatch(/Not indexed/);
    expect(chainHealth(live({ headAgeSeconds: 600 }), store()).reasons[0]).toMatch(/600s old/);
    const issue: IssueRow = { chain: "base", asset: "usdc", kind: "supply_mismatch", block: 900, detail: "d", occurrences: 1, first_seen: "a", last_seen: "b" };
    const h = chainHealth(live(), store({ issues: [issue] }));
    expect(h.state).toBe("DEGRADED");
    expect(h.reasons[0]).toMatch(/supply_mismatch/);
  });
  it("store missing -> DEGRADED with the reason, live numbers still shown", () => {
    const h = chainHealth(live(), store({ available: false, reason: "Network index tables are not migrated yet (apply migration 0034).", asset: null }));
    expect(h).toMatchObject({ state: "DEGRADED", reasons: ["Network index tables are not migrated yet (apply migration 0034)."] });
  });
  it("Solana is judged on its wallet indexer, with slots and lag", () => {
    const h = chainHealth(live({ chain: "solana", latestBlock: 5000 }), store({ asset: null, wallet: idx({ indexer: "wallet", chain: "solana", indexed_block: 4970, detail: { wallets: 2, tokenAccounts: 5 } }) }));
    expect(h.state).toBe("LIVE");
    expect(h.wallet).toMatchObject({ indexedSlot: 4970, wallets: 2, tokenAccounts: 5, lagSlots: 30 });
  });
  it("Solana without its wallet indexer (or without a store) is DEGRADED like any other chain, with the reason", () => {
    expect(chainHealth(live({ chain: "solana" }), store({ asset: null, wallet: null })).reasons[0]).toMatch(/Tracked-wallet indexer has not run/);
    expect(chainHealth(live({ chain: "solana" }), store({ asset: null, wallet: null, available: false, reason: "No durable store" })).state).toBe("DEGRADED");
  });
});

describe("summarizeHistory", () => {
  const from = new Date("2026-10-07T00:00:00Z");
  const to = new Date("2026-10-08T00:00:00Z");
  const rows: SeriesRow[] = [
    { bucket: "2026-10-07T10:00:00Z", chain: "base", transfers: 3, transfer_raw: "3000000", mints: 1, mint_raw: "500000", burns: 0, burn_raw: "0" },
    { bucket: "2026-10-07T11:00:00Z", chain: "base", transfers: 2, transfer_raw: "1500000", mints: 0, mint_raw: "0", burns: 1, burn_raw: "200000" },
    { bucket: "2026-10-07T10:00:00Z", chain: "ethereum", transfers: 1, transfer_raw: "9000000", mints: 0, mint_raw: "0", burns: 0, burn_raw: "0" },
  ];
  const supply: SupplyRow[] = [
    { bucket: "2026-10-07T10:00:00Z", chain: "base", block: 1, supply_raw: "1000000000", decimals: 6 },
    { bucket: "2026-10-07T11:00:00Z", chain: "base", block: 2, supply_raw: "1100000000", decimals: 6 },
    { bucket: "2026-10-07T11:00:00Z", chain: "solana", block: 9, supply_raw: "3000000000", decimals: 6 },
    { bucket: "2026-10-07T12:00:00Z", chain: "solana", block: 10, supply_raw: "2850000000", decimals: 6 },
  ];
  const coverage = [
    { chain: "base", coveredFrom: "2026-10-06T00:00:00Z", coveredTo: "2026-10-07T23:00:00Z", activity: true },
    { chain: "ethereum", coveredFrom: "2026-10-07T09:30:00Z", coveredTo: "2026-10-07T23:00:00Z", activity: true },
    { chain: "solana", coveredFrom: "2026-10-07T11:00:00Z", coveredTo: "2026-10-07T12:00:00Z", activity: false },
    { chain: "polygon", coveredFrom: null, coveredTo: null, activity: true },
  ];
  const h = summarizeHistory("24h", from, to, rows, supply, coverage);

  it("exact per-chain totals; partial coverage is flagged", () => {
    const base = h.chains.find((c) => c.chain === "base")!;
    expect(base).toMatchObject({ partial: false, transfers: 5, volume: "4.5", minted: "0.5", burned: "0.2", supplyStart: "1000", supplyEnd: "1100", supplyChange: "100", supplyGrowth: 0.1 });
    expect(h.chains.find((c) => c.chain === "ethereum")!.partial).toBe(true);
  });
  it("totals and activity rankings include only chains with indexed activity — Solana and unindexed chains are not ranked as zero", () => {
    expect(h.totals).toMatchObject({ chains: ["base", "ethereum"], transfers: 6, volume: "13.5" });
    expect(h.rankings.volume.map((r) => r.chain)).toEqual(["ethereum", "base"]);
    expect(h.rankings.transfers.map((r) => r.chain)).toEqual(["base", "ethereum"]);
    const sol = h.chains.find((c) => c.chain === "solana")!;
    expect(sol).toMatchObject({ activity: false, transfers: null, volume: null });
    expect(h.rankings.notRanked).toEqual(
      expect.arrayContaining([
        { chain: "polygon", reason: "Not indexed yet." },
        { chain: "solana", reason: "Supply only: network-wide transfer activity needs a Geyser stream." },
      ])
    );
  });
  it("supply growth and share rank only chains with supply snapshots", () => {
    expect(h.rankings.supplyGrowth.map((r) => [r.chain, r.value])).toEqual([
      ["base", 0.1],
      ["solana", -0.05],
    ]);
    expect(h.rankings.supplyShare.map((r) => r.chain)).toEqual(["solana", "base"]);
    expect(h.rankings.supplyShare.reduce((a, r) => a + r.value, 0)).toBeCloseTo(1, 5);
  });
  it("no coverage -> no totals (null, not zeros)", () => {
    expect(summarizeHistory("1h", from, to, [], [], []).totals).toBeNull();
  });
});
