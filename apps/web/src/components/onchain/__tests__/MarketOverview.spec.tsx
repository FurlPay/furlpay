/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { OnchainDashboard } from "@/lib/onchain/dashboard";
import { MarketOverview } from "../MarketOverview";

// recharts' ResponsiveContainer needs a ResizeObserver; jsdom has none.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

const market = {
  totalSupplyUsd: 300e9,
  supplyChange30d: 0.012,
  topCoins: [
    { symbol: "USDT", name: "Tether", supplyUsd: 180e9, share: 0.6 },
    { symbol: "USDC", name: "USD Coin", supplyUsd: 75e9, share: 0.25 },
  ],
  topChains: [{ chain: "Ethereum", supplyUsd: 170e9, share: 170 / 300 }],
  supplySeries: [],
};
const fresh = { state: "updating", source: "DefiLlama", asOf: "2026-10-12T00:00:00Z", cadence: "every 30 min" };
const dash = (over: Partial<OnchainDashboard> = {}) =>
  ({
    market: { status: "ok", data: market, asOf: "2026-10-12T00:00:00Z", source: "DefiLlama" },
    freshness: { market: fresh },
    ...over,
  }) as unknown as OnchainDashboard;

describe("MarketOverview", () => {
  it("lists every asset plus the unlisted remainder, with shares", () => {
    render(<MarketOverview data={dash()} />);
    const list = within(screen.getByRole("list", { name: "Supply breakdown" }));
    expect(list.getByText("USDT")).toBeTruthy();
    expect(list.getByText("USDC")).toBeTruthy();
    expect(list.getByText("Others")).toBeTruthy();
    expect(list.getByText("15.0%")).toBeTruthy(); // 45B of 300B
    expect(screen.getByText("Total supply")).toBeTruthy();
  });

  it("switches to chains", () => {
    render(<MarketOverview data={dash()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Chains" }));
    const list = within(screen.getByRole("list", { name: "Supply breakdown" }));
    expect(list.getByText("Ethereum")).toBeTruthy();
    expect(list.queryByText("USDT")).toBeNull();
  });

  it("legend rows toggle a slice and report their state", () => {
    render(<MarketOverview data={dash()} />);
    const row = screen.getByRole("button", { name: /USDT/ });
    expect(row.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(row);
    expect(row.getAttribute("aria-pressed")).toBe("false");
  });

  it("offers no tab for metrics it has no source for", () => {
    render(<MarketOverview data={dash()} />);
    expect(screen.queryByRole("tab", { name: /Velocity|Holders/ })).toBeNull();
  });

  it("shows the source's reason instead of a chart when unavailable", () => {
    render(<MarketOverview data={dash({ market: { status: "unavailable", reason: "DefiLlama responded 503", source: "DefiLlama" } } as never)} />);
    expect(screen.getByText("DefiLlama responded 503")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Supply breakdown" })).toBeNull();
  });
});
