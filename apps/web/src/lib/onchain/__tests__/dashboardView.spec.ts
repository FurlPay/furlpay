import { describe, it, expect } from "vitest";
import { CHAIN_FILTERS, type OnchainDashboard } from "../dashboard";
import type { SectionFreshness } from "../freshness";
import { VIEW_CHAINS, exportCsv, exportJson, supplyBreakdown, systemStatus, viewParams, viewQuery, volumeLayers } from "../dashboardView";

const f = (state: SectionFreshness["state"], reason?: string): SectionFreshness => ({ state, source: "s", asOf: "2026-10-12T00:00:00Z", cadence: "c", ...(reason ? { reason } : {}) });
const fresh = (over: Partial<OnchainDashboard["freshness"]> = {}): OnchainDashboard["freshness"] => ({
  ledger: f("live"),
  risk: f("live"),
  market: f("updating"),
  alliumDaily: f("delayed"),
  alliumChains: f("delayed"),
  corridors: f("delayed"),
  holdings: f("updating"),
  ...over,
});

const kpi = (value: number) => ({ value, change: null, series: [] });
function dash(over: Partial<OnchainDashboard> = {}): OnchainDashboard {
  return {
    generatedAt: "2026-10-12T11:42:00.000Z",
    range: { key: "30d", from: "2026-09-12", to: "2026-10-12", bucket: "day", buckets: [] },
    chain: "all",
    ledger: {
      status: "ok",
      source: "FurlPay ledger (ops_tx_events)",
      data: {
        truncated: false,
        kpis: { volume: kpi(1250.5), transactions: kpi(3), users: kpi(2), recipients: kpi(2), fees: kpi(1.25) },
        volumeByBucket: [],
        chains: [{ chain: "base", volume: 1250.5, count: 3, share: 1 }],
        rails: [],
        counterparties: [{ address: "=HYPERLINK(\"x\")", volume: 10, count: 1, chain: "base" }],
        flow: { sources: [], destinations: [] },
        activity: [],
      },
    },
    risk: { status: "unavailable", reason: "no store", source: "ops_security_events" },
    market: { status: "unavailable", reason: "x", source: "DefiLlama" },
    alliumConfigured: false,
    alliumDaily: { status: "unavailable", reason: "ALLIUM_API_KEY is not set.", source: "Allium" },
    alliumChains: { status: "unavailable", reason: "x", source: "Allium" },
    corridors: { status: "unavailable", reason: "x", source: "Allium" },
    holdings: { status: "unavailable", reason: "x", source: "treasury" },
    freshness: fresh(),
    ...over,
  } as OnchainDashboard;
}

describe("systemStatus", () => {
  it("is operational only when every connected source is healthy", () => {
    expect(systemStatus(fresh()).level).toBe("operational");
    expect(systemStatus(fresh()).label).toBe("All connected sources healthy");
  });

  it("never folds unconnected sources into a green light silently", () => {
    const s = systemStatus(fresh({ alliumDaily: f("not_connected"), corridors: f("not_connected") }));
    expect(s.level).toBe("operational");
    expect(s.notConnected).toBe(2);
    expect(s.label).toBe("All connected sources healthy · 2 not connected");
  });

  it("reports degraded with a count when a connected source is stale or offline", () => {
    const s = systemStatus(fresh({ market: f("stale"), risk: f("offline", "boom") }));
    expect(s.level).toBe("degraded");
    expect(s.label).toBe("2 of 7 sources degraded");
    expect(s.sections.find((x) => x.key === "risk")?.reason).toBe("boom");
  });

  it("is offline when nothing connected is healthy", () => {
    const all = Object.fromEntries(Object.keys(fresh()).map((k) => [k, f("offline")])) as OnchainDashboard["freshness"];
    expect(systemStatus(all).level).toBe("offline");
    const none = Object.fromEntries(Object.keys(fresh()).map((k) => [k, f("not_connected")])) as OnchainDashboard["freshness"];
    expect(systemStatus(none).label).toBe("No sources connected");
  });
});

describe("volumeLayers", () => {
  it("never invents an adjusted series and says why a layer is missing", () => {
    const [raw, adjusted, economic, ledger] = volumeLayers(dash());
    expect(raw.value).toBeNull();
    expect(raw.unavailable).toMatch(/ALLIUM_API_KEY/);
    expect(adjusted.value).toBeNull();
    expect(economic.value).toBeNull();
    expect(adjusted.label).not.toEqual(economic.label);
    expect(ledger.value).toBe(1250.5);
  });

  it("shows raw on-chain volume over Allium's own window, not the page range", () => {
    const d = dash({
      alliumDaily: {
        status: "ok",
        asOf: "2026-10-11",
        source: "Allium",
        data: { days: [], latest: { day: "2026-10-11" } as never, latestProvisional: false, prior7dAvg: null, change: { volumeUsd: null, txCount: null, avgTransferUsd: null }, windowTotals: { volumeUsd: 9e9, txCount: 1, days: 14 } },
      },
    });
    const raw = volumeLayers(d)[0];
    expect(raw.value).toBe(9e9);
    expect(raw.window).toBe("14 days to 2026-10-11");
  });
});

describe("view params", () => {
  it("keeps the client chain list in step with the server's", () => {
    expect([...VIEW_CHAINS]).toEqual([...CHAIN_FILTERS]);
  });
  it("accepts known values and falls back on anything else", () => {
    expect(viewParams("?range=7d&chain=Base")).toEqual({ range: "7d", chain: "base" });
    expect(viewParams("?range=1y&chain=tron")).toEqual({ range: "30d", chain: "all" });
    expect(viewParams("")).toEqual({ range: "30d", chain: "all" });
  });
  it("omits defaults so the plain URL stays plain", () => {
    expect(viewQuery("30d", "all")).toBe("");
    expect(viewQuery("90d", "solana")).toBe("?range=90d&chain=solana");
  });
});

describe("export", () => {
  it("writes provenance and neutralises spreadsheet formulas", () => {
    const csv = exportCsv(dash());
    expect(csv).toContain("generated_at,2026-10-12T11:42:00.000Z");
    expect(csv).toContain("ledger_kpi,volume,1250.5,30d");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toMatch(/Adjusted volume,,,.*unavailable/);
    expect(csv).toMatch(/Economic payments,,,.*unavailable/);
  });
  it("JSON carries the status and layers alongside the data", () => {
    const j = JSON.parse(exportJson(dash()));
    expect(j.status.level).toBe("operational");
    expect(j.volumeLayers).toHaveLength(4);
    expect(j.dashboard.chain).toBe("all");
  });
});

describe("supplyBreakdown", () => {
  const m = {
    totalSupplyUsd: 300,
    topCoins: [{ symbol: "USDT", supplyUsd: 180 }, { symbol: "USDC", supplyUsd: 75 }, { symbol: "ZERO", supplyUsd: 0 }],
    topChains: [{ chain: "Ethereum", supplyUsd: 170 }],
  };
  it("adds the unlisted remainder as Others, so shares sum to one", () => {
    const s = supplyBreakdown(m, "asset");
    expect(s.map((x) => x.label)).toEqual(["USDT", "USDC", "Others"]);
    expect(s.at(-1)!.supplyUsd).toBe(45);
    expect(s.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1, 10);
  });
  it("works by chain and returns nothing for an empty market", () => {
    expect(supplyBreakdown(m, "chain").map((x) => x.supplyUsd)).toEqual([170, 130]);
    expect(supplyBreakdown({ ...m, totalSupplyUsd: 0 }, "asset")).toEqual([]);
  });
  it("adds no Others slice when the listed rows are the whole total", () => {
    expect(supplyBreakdown({ totalSupplyUsd: 10, topCoins: [{ symbol: "A", supplyUsd: 10 }], topChains: [] }, "asset").map((x) => x.label)).toEqual(["A"]);
  });
});
