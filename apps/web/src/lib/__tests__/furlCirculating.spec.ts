import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeCirculating,
  issuerTokenAccount,
  ISSUER_OWNERS,
  type IssuerAccount,
} from "@/lib/token/furlCirculating";
import { FURL_DEPLOYER, FURL_TOTAL_SUPPLY_BASE_UNITS, baseUnitsToFurl } from "@/lib/token/furl";

// ---------------------------------------------------------------------------
// Circulating supply attribution.
//
// The bug these tests exist to prevent: the original implementation excluded a
// holder if its share was "100.00" or if it was the only holder. That is true
// of today's state and of nothing else. After the treasury migrates to six
// multisigs holding 40/20/15/15/5/5, no holder is at 100% and there are six of
// them — so the heuristic would exclude NOTHING and report the entire
// 1,000,000,000 FURL as circulating, on the exact day custody got safer.
//
// Attribution is therefore by identity: each issuer owner is resolved to its
// Token-2022 ATA and matched by address.
// ---------------------------------------------------------------------------

const DEPLOYER_ATA = "EU2tUJ1CoU8VjTKEuK49FTBv1N2Hk5jpv2589Eq1eZ1S";
const TOTAL = FURL_TOTAL_SUPPLY_BASE_UNITS;

/** Six plausible multisig owners. Real base58 keys, but NOT real multisigs —
 *  they stand in for addresses that do not exist yet. */
const SIMULATED_MULTISIGS: IssuerAccount[] = [
  { owner: "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk", label: "Community (40%)", reason: "Undistributed" },
  { owner: "Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb", label: "Liquidity (20%)", reason: "Pool seed" },
  { owner: "Gso2TParHRFzzzPphM9SyZE1bb6oea7T7Nzfw9MqG2MX", label: "Treasury (15%)", reason: "Operating" },
  { owner: "FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUU", label: "Team (15%)", reason: "Unvested" },
  { owner: "11111111111111111111111111111111", label: "Partnerships (5%)", reason: "Undistributed" },
  { owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", label: "Reserve (5%)", reason: "Incident reserve" },
];

const pct = (p: bigint) => (TOTAL * p) / 100n;

describe("1. current state — one holder, circulating = 0", () => {
  it("excludes the deployer's ATA and reports zero float", () => {
    const r = computeCirculating(TOTAL, [{ tokenAccount: DEPLOYER_ATA, amountRaw: TOTAL.toString() }]);
    expect(r.circulatingRaw).toBe(0n);
    expect(r.excludedRaw).toBe(TOTAL);
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0].owner).toBe(FURL_DEPLOYER);
    expect(r.publicHolders).toHaveLength(0);
  });

  it("derives the deployer ATA that actually holds the supply on mainnet", () => {
    expect(issuerTokenAccount(FURL_DEPLOYER)).toBe(DEPLOYER_ATA);
  });
});

describe("2. simulated post-migration — six multisigs, circulating STILL 0", () => {
  const holders = SIMULATED_MULTISIGS.map((m, i) => ({
    tokenAccount: issuerTokenAccount(m.owner)!,
    amountRaw: pct([40n, 20n, 15n, 15n, 5n, 5n][i]).toString(),
  }));

  it("every multisig is excluded, so float stays zero", () => {
    const r = computeCirculating(TOTAL, holders, SIMULATED_MULTISIGS);
    expect(r.excludedRaw).toBe(TOTAL);
    expect(r.circulatingRaw).toBe(0n);
    expect(r.excluded).toHaveLength(6);
    expect(r.publicHolders).toHaveLength(0);
  });

  it("the six excluded amounts are exactly the published allocation", () => {
    const r = computeCirculating(TOTAL, holders, SIMULATED_MULTISIGS);
    expect(r.excluded.map((e) => e.amount)).toEqual([
      "400000000", "200000000", "150000000", "150000000", "50000000", "50000000",
    ]);
  });

  it("the OLD heuristic would have failed here — this is the regression", () => {
    // No holder is at 100%, and there are six of them. "Exclude the 100% holder
    // or the only holder" would have excluded nothing at all.
    const noneIsFullSupply = holders.every((h) => BigInt(h.amountRaw) !== TOTAL);
    expect(noneIsFullSupply).toBe(true);
    expect(holders.length).toBeGreaterThan(1);

    // Identity-based attribution still gets it right.
    expect(computeCirculating(TOTAL, holders, SIMULATED_MULTISIGS).circulatingRaw).toBe(0n);
  });
});

describe("3. a genuine public holder counts toward float", () => {
  it("includes a non-issuer account", () => {
    const publicOwner = "GsoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const holders = [
      { tokenAccount: DEPLOYER_ATA, amountRaw: pct(90n).toString() },
      { tokenAccount: publicOwner, amountRaw: pct(10n).toString() },
    ];
    const r = computeCirculating(TOTAL, holders);
    expect(r.circulatingRaw).toBe(pct(10n));
    expect(r.publicHolders).toHaveLength(1);
    expect(r.publicHolders[0].amount).toBe("100000000");
    expect(baseUnitsToFurl(r.circulatingRaw)).toBe("100000000");
  });

  it("a partially-distributed treasury yields partial float", () => {
    const holders = [
      { tokenAccount: DEPLOYER_ATA, amountRaw: pct(75n).toString() },
      { tokenAccount: "PublicHolderOne1111111111111111111111111111", amountRaw: pct(15n).toString() },
      { tokenAccount: "PublicHolderTwo1111111111111111111111111111", amountRaw: pct(10n).toString() },
    ];
    const r = computeCirculating(TOTAL, holders);
    expect(r.circulatingRaw).toBe(pct(25n));
    expect(r.publicHolders).toHaveLength(2);
  });
});

describe("4. failure modes never fabricate a number", () => {
  it("flags an issuer owner that cannot be resolved", () => {
    const r = computeCirculating(TOTAL, [], [{ owner: "not-base58", label: "x", reason: "y" }]);
    expect(r.unresolvedIssuer).toBe(true);
  });

  it("clamps at zero rather than reporting negative circulating supply", () => {
    // Excluded exceeding total means the reads disagree; the route turns this
    // into a 503 rather than publishing the clamp.
    const r = computeCirculating(pct(50n), [
      { tokenAccount: DEPLOYER_ATA, amountRaw: TOTAL.toString() },
    ]);
    expect(r.circulatingRaw).toBe(0n);
    expect(r.excludedRaw).toBeGreaterThan(pct(50n));
  });

  it("no holders at all is INCOHERENT, and the route must reject it", () => {
    // The pure function is arithmetic: with nothing to exclude it reports the
    // whole supply as circulating. That is the single most dangerous output
    // this module can produce, so the API layer refuses it rather than
    // publishing it — a flaky RPC returning `ok` with an empty account list
    // would otherwise print "1,000,000,000 circulating" and be cached by every
    // aggregator that asked.
    const r = computeCirculating(TOTAL, []);
    expect(r.circulatingRaw).toBe(TOTAL);
    expect(r.excludedRaw).toBe(0n);

    // The guard condition the route uses to turn this into a 503.
    const incoherent = TOTAL > 0n && r.excluded.length === 0 && r.publicHolders.length === 0;
    expect(incoherent).toBe(true);
  });

  it("the route's no-holders guard is present and returns 503", () => {
    const route = readFileSync(
      join(__dirname, "..", "..", "app", "api", "token", "furl", "supply", "route.ts"),
      "utf8",
    );
    expect(route).toMatch(/no_holders_attributed/);
    expect(route).toMatch(/split\.excluded\.length === 0 && split\.publicHolders\.length === 0/);
  });
});

describe("5. issuer registry", () => {
  it("currently lists exactly the deployer", () => {
    expect(ISSUER_OWNERS).toHaveLength(1);
    expect(ISSUER_OWNERS[0].owner).toBe(FURL_DEPLOYER);
  });

  it("supports adding multisigs dynamically without code changes elsewhere", () => {
    const extended = [...ISSUER_OWNERS, ...SIMULATED_MULTISIGS];
    expect(extended).toHaveLength(7);
    const holders = [{ tokenAccount: issuerTokenAccount(SIMULATED_MULTISIGS[0].owner)!, amountRaw: pct(40n).toString() }];
    const r = computeCirculating(TOTAL, holders, extended);
    expect(r.excludedRaw).toBe(pct(40n));
  });

  it("resolves multisig PDAs (off-curve owners) to token accounts", () => {
    // A Squads vault is a PDA, so ATA derivation must allow off-curve owners.
    for (const m of SIMULATED_MULTISIGS) {
      expect(issuerTokenAccount(m.owner)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    }
  });
});
