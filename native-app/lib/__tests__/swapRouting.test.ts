import {
  ASSETS,
  CHAINS,
  assetBySymbol,
  isAssetUnroutable,
  routability,
  routableChainsFor,
  swapWarnings,
  HIGH_IMPACT_PCT,
  LARGE_SWAP_USD,
} from "../swap/assets";

// The swap catalogue is the gate that decides what the UI is allowed to offer.
// Every rule here exists because the alternative is a user typing an amount,
// waiting for a quote, and being told the pair was never possible.

describe("routability", () => {
  it("refuses any pair touching a chain we cannot price", () => {
    // LI.FI is EVM-only; Jupiter is not built. No Solana leg can be quoted.
    expect(routability("solana", "arbitrum").routable).toBe(false);
    expect(routability("arbitrum", "solana").routable).toBe(false);
    expect(routability("solana", "solana").routable).toBe(false);
  });

  it("explains the refusal in words a user can act on", () => {
    const r = routability("solana", "base");
    expect(r.routable).toBe(false);
    expect(r.reason).toBe("Solana routing coming soon");
    // Not a code, not a stack trace.
    expect(r.reason).not.toMatch(/error|null|undefined/i);
  });

  it("allows ordinary EVM pairs, same-chain and cross-chain", () => {
    expect(routability("arbitrum", "arbitrum", "USDT", "USDC").routable).toBe(true);
    expect(routability("base", "polygon", "USDC", "DAI").routable).toBe(true);
  });

  it("rejects a no-op swap of an asset for itself on the same chain", () => {
    expect(routability("base", "base", "USDC", "USDC").routable).toBe(false);
    // …but the same symbol on two chains is a real bridge, not a no-op.
    expect(routability("base", "arbitrum", "USDC", "USDC").routable).toBe(true);
  });

  it("never reports an asset as routable on a chain it cannot be routed on", () => {
    for (const asset of ASSETS) {
      for (const chain of routableChainsFor(asset)) {
        expect(CHAINS[chain.id].routable).toBe(true);
      }
    }
  });

  it("marks SOL unroutable because it exists only on Solana", () => {
    expect(isAssetUnroutable(assetBySymbol("SOL")!)).toBe(true);
    // USDC also lists Solana, but has EVM homes, so it stays selectable.
    expect(isAssetUnroutable(assetBySymbol("USDC")!)).toBe(false);
  });

  it("every asset in the catalogue has a chain listed", () => {
    for (const asset of ASSETS) expect(asset.chains.length).toBeGreaterThan(0);
  });
});

describe("swapWarnings", () => {
  const base = { amountUsd: 100, fromChain: "arbitrum" as const, toChain: "arbitrum" as const };

  it("says nothing about an ordinary same-chain swap", () => {
    expect(swapWarnings(base)).toEqual([]);
  });

  it("flags a cross-chain swap as a different trust model, not just slower", () => {
    const w = swapWarnings({ ...base, toChain: "base" });
    const cross = w.find((x) => x.id === "cross_chain");
    expect(cross).toBeDefined();
    expect(cross!.detail).toMatch(/bridge/i);
    expect(cross!.detail).toMatch(/cannot be cancelled/i);
  });

  it("flags high price impact as the most severe warning", () => {
    const w = swapWarnings({ ...base, toChain: "base", priceImpactPct: HIGH_IMPACT_PCT + 1 });
    expect(w[0].id).toBe("price_impact");
    expect(w[0].level).toBe("danger");
  });

  it("does not flag impact just below the threshold", () => {
    const w = swapWarnings({ ...base, priceImpactPct: HIGH_IMPACT_PCT - 0.01 });
    expect(w.find((x) => x.id === "price_impact")).toBeUndefined();
  });

  it("flags a large swap at the boundary, not one below it", () => {
    expect(swapWarnings({ ...base, amountUsd: LARGE_SWAP_USD }).some((w) => w.id === "large_swap")).toBe(true);
    expect(swapWarnings({ ...base, amountUsd: LARGE_SWAP_USD - 1 }).some((w) => w.id === "large_swap")).toBe(false);
  });

  it("orders warnings most severe first so a truncated list still leads with the worst", () => {
    const w = swapWarnings({
      ...base,
      toChain: "base",
      amountUsd: LARGE_SWAP_USD * 2,
      priceImpactPct: HIGH_IMPACT_PCT + 5,
    });
    const rank = { danger: 2, warn: 1, info: 0 } as const;
    for (let i = 1; i < w.length; i++) {
      expect(rank[w[i - 1].level]).toBeGreaterThanOrEqual(rank[w[i].level]);
    }
  });

  it("gives every warning an id, a title and a detail", () => {
    const w = swapWarnings({
      ...base,
      toChain: "base",
      amountUsd: LARGE_SWAP_USD,
      priceImpactPct: HIGH_IMPACT_PCT + 1,
    });
    expect(w.length).toBeGreaterThan(0);
    for (const x of w) {
      expect(x.id).toBeTruthy();
      expect(x.title).toBeTruthy();
      expect(x.detail.length).toBeGreaterThan(10);
    }
  });
});

describe("peg metadata backs the price-impact figure", () => {
  // usePriceImpact returns a number ONLY when both assets share a peg. If a
  // stablecoin loses its peg annotation the impact silently disappears rather
  // than being computed against the wrong reference — so pin the annotations.
  it("annotates every stablecoin with a peg", () => {
    for (const a of ASSETS.filter((x) => x.assetClass === "stablecoin")) {
      expect(a.peg).toBeDefined();
    }
  });

  it("does not annotate non-stablecoins with a peg", () => {
    for (const a of ASSETS.filter((x) => x.assetClass !== "stablecoin")) {
      expect(a.peg).toBeUndefined();
    }
  });

  it("keeps differently-pegged stablecoins distinguishable", () => {
    expect(assetBySymbol("USDC")!.peg).toBe("USD");
    expect(assetBySymbol("EURC")!.peg).toBe("EUR");
    expect(assetBySymbol("XSGD")!.peg).toBe("SGD");
    // A USD→EUR swap must NOT be treated as a 1:1 pair.
    expect(assetBySymbol("USDC")!.peg).not.toBe(assetBySymbol("EURC")!.peg);
  });
});

describe("explorer links are coupled to real chains", () => {
  it("only provides a tx URL for chains that have a public explorer", () => {
    for (const chain of Object.values(CHAINS)) {
      if (chain.explorerTx) expect(chain.explorerTx).toMatch(/^https:\/\/\S+\/tx\/$/);
    }
  });
});
