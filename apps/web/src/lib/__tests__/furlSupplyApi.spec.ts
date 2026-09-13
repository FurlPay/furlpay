import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FURL_ALLOCATIONS, FURL_TOTAL_SUPPLY, FURL_DEPLOYER } from "@/lib/token/furl";

// ---------------------------------------------------------------------------
// Supply endpoint + tokenomics invariants.
//
// Two things are locked here, both of which are ways token projects misreport
// their own supply:
//
//  1. CIRCULATING SUPPLY MUST BE COMPUTED FROM CHAIN, NEVER DECLARED. Today it
//     is 0 — 100% of FURL sits in the deployer's account, so there is no public
//     float. Returning 1,000,000,000 instead would let any aggregator multiply
//     it by a price and print a market cap out of nothing. CoinGecko's own
//     methodology excludes team and treasury holdings for exactly this reason.
//
//  2. THE PUBLISHED ALLOCATION MUST MATCH WHAT WAS MINTED. The live on-chain
//     split is 40/20/15/15/5/5. A planning document proposed replacing it with
//     30/20/15/15/12/8 including a 12% "Strategic/Seed Investors" bucket that
//     does not exist on chain and was never minted. Restating tokenomics after
//     launch is exactly the misleading-claim category this repo keeps removing.
// ---------------------------------------------------------------------------

const ROUTE = join(
  __dirname, "..", "..", "app", "api", "token", "furl", "supply", "route.ts",
);
const source = readFileSync(ROUTE, "utf8");

describe("circulating supply is computed, not hard-coded", () => {
  it("never returns the total supply as the circulating figure", () => {
    // The literal that would fake a market cap.
    expect(source).not.toMatch(/circulating_supply:\s*1_?000_?000_?000/);
    expect(source).not.toMatch(/circulating_supply:\s*FURL_TOTAL_SUPPLY/);
  });

  it("derives circulating by subtracting issuer-held balances", () => {
    expect(source).toMatch(/totalRaw\s*-\s*excludedRaw/);
    expect(source).toMatch(/excludedRaw\s*\+=/);
  });

  it("reads the exclusion from a chain call rather than a constant", () => {
    expect(source).toMatch(/readFurlConcentration/);
    expect(source).toMatch(/holder\.amountRaw/);
  });

  it("refuses to answer when the chain is unreadable, instead of returning 0", () => {
    // An aggregator caches what it is given; a fabricated figure outlives the
    // outage that produced it.
    expect(source).toMatch(/503/);
    expect(source).toMatch(/!mintState\.ok/);
    expect(source).toMatch(/!concentration\.ok/);
  });

  it("publishes which accounts were excluded, so the figure is checkable", () => {
    expect(source).toMatch(/excluded_from_circulating/);
    expect(source).toMatch(/circulating_supply_methodology/);
  });

  it("carries the authority state and disclosures with the numbers", () => {
    expect(source).toMatch(/mint_authority_active/);
    expect(source).toMatch(/freeze_authority/);
    expect(source).toMatch(/peg:\s*"none"/);
    expect(source).toMatch(/reserves:\s*"none"/);
    expect(source).toMatch(/redemption:\s*"none"/);
  });

  it("uses integer-safe conversion for supply strings", () => {
    // Base units for the full supply are 1e15; float math loses value above
    // ~9.007e15, and the raw string must stay exact regardless.
    expect(source).toMatch(/baseUnitsToFurl/);
    expect(source).toMatch(/BigInt\(/);
  });

  it("excludes the deployer by default", () => {
    expect(source).toContain("FURL_DEPLOYER");
    expect(FURL_DEPLOYER).toBe("FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUL");
  });
});

describe("published tokenomics match what is minted on-chain", () => {
  it("is exactly 40/20/15/15/5/5", () => {
    expect(FURL_ALLOCATIONS.map((a) => a.percent)).toEqual([40, 20, 15, 15, 5, 5]);
  });

  it("sums to 100% and to the full 1,000,000,000 supply", () => {
    expect(FURL_ALLOCATIONS.reduce((a, b) => a + b.percent, 0)).toBe(100);
    const furl = FURL_ALLOCATIONS.reduce(
      (sum, a) => sum + (FURL_TOTAL_SUPPLY * a.percent) / 100,
      0,
    );
    expect(furl).toBe(FURL_TOTAL_SUPPLY);
  });

  it("does NOT contain an investor allocation — none was ever minted", () => {
    const keys = FURL_ALLOCATIONS.map((a) => a.key.toLowerCase());
    const labels = FURL_ALLOCATIONS.map((a) => a.label.toLowerCase()).join(" ");
    for (const banned of ["investor", "seed", "strategic", "private", "presale"]) {
      expect(keys).not.toContain(banned);
      expect(labels).not.toContain(banned);
    }
  });

  it("rejects the superseded 30/20/15/15/12/8 model", () => {
    const percents = FURL_ALLOCATIONS.map((a) => a.percent);
    expect(percents).not.toEqual([30, 20, 15, 15, 12, 8]);
    // The community bucket is 40, not 30 — the single most-cited difference.
    expect(FURL_ALLOCATIONS.find((a) => a.key === "community")?.percent).toBe(40);
  });

  it("has exactly six buckets, matching the six mint transactions", () => {
    expect(FURL_ALLOCATIONS).toHaveLength(6);
    expect(FURL_ALLOCATIONS.map((a) => a.key)).toEqual([
      "community", "liquidity", "treasury", "team", "partnerships", "reserve",
    ]);
  });
});
