import { describe, it, expect } from "vitest";
import { getAddress } from "viem";

import {
  assertSettleable,
  assetConcentrationBps,
  AssetNotSettleable,
  canSettleIn,
  deploymentForAsset,
  PEG_QUOTE_MAX_AGE_MS,
  pegHealth,
  pegQuote,
  settlementAssets,
  STABLECOINS,
  stablecoinForAsset,
  type PegQuote,
} from "../stablecoins";

// ---------------------------------------------------------------------------
// The stablecoin registry.
//
// Each block is a way real money has been lost: settling in a bridge IOU,
// pricing a depegged token at par, retrying into a frozen address, or holding
// one issuer's token as the entire treasury.
// ---------------------------------------------------------------------------

function quote(price: string, ageMs = 0, assetId = "USDC.arbitrum"): PegQuote {
  return pegQuote({
    assetId,
    price,
    source: "test",
    observedAt: new Date(Date.now() - ageMs).toISOString(),
  });
}

describe("peg status — par is never the fallback", () => {
  it("classifies a quote at par as at_peg", () => {
    expect(pegHealth(quote("1.00"))).toBe("at_peg");
  });

  it("treats an ABSENT quote as unknown, not as at_peg", () => {
    // The whole point. An oracle outage during a depeg looks exactly like calm
    // markets if the fallback is par — and that is precisely when the answer
    // matters most.
    expect(pegHealth(null)).toBe("unknown");
  });

  it("treats a STALE quote as unknown", () => {
    expect(pegHealth(quote("1.00", PEG_QUOTE_MAX_AGE_MS + 1_000))).toBe("unknown");
  });

  it("treats an unparseable timestamp as unknown", () => {
    const bad: PegQuote = { ...quote("1.00"), observedAt: "not-a-date" };
    expect(pegHealth(bad)).toBe("unknown");
  });

  it("holds the precision a peg quote actually needs", () => {
    // The design bug a test caught: the peg currency's own precision is two
    // decimals, which cannot express 0.9985 — exactly the band where drift
    // lives. Quoting a peg in cents rounds every interesting observation to par.
    expect(pegHealth(quote("0.9985"))).toBe("at_peg");
    expect(pegHealth(quote("0.9940"))).toBe("drifting");
    expect(() => quote("1.0000001")).toThrow(/decimal places/);
  });

  it("bands drift and depeg symmetrically, above and below par", () => {
    expect(pegHealth(quote("1.0020"))).toBe("at_peg"); // 20bps
    expect(pegHealth(quote("0.9980"))).toBe("at_peg");
    expect(pegHealth(quote("1.0100"))).toBe("drifting"); // 100bps
    expect(pegHealth(quote("0.9900"))).toBe("drifting");
    expect(pegHealth(quote("1.0500"))).toBe("depegged"); // 500bps
    expect(pegHealth(quote("0.9500"))).toBe("depegged");
  });
});

describe("settlement eligibility", () => {
  it("allows a canonical, accepted asset at peg", () => {
    const decision = canSettleIn("USDC.arbitrum", quote("1.00"));
    expect(decision.allowed).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it("REFUSES when the peg is unknown", () => {
    // Settling at an assumed par during an oracle outage is how a platform
    // sells dollars it does not have.
    const decision = canSettleIn("USDC.arbitrum", null);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("peg_unknown");
  });

  it("REFUSES a depegged asset", () => {
    const decision = canSettleIn("USDC.arbitrum", quote("0.94"));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("depegged");
  });

  it("ALLOWS a drifting asset", () => {
    // Ordinary market noise is a pricing problem, not a solvency problem.
    // Halting on it would train operators to raise the threshold until it
    // never fires.
    expect(canSettleIn("USDC.arbitrum", quote("1.008")).allowed).toBe(true);
  });

  it("REFUSES when the issuer has frozen us", () => {
    // A payout to a frozen address fails permanently. A system that cannot
    // represent this retries forever and reports a transient error.
    const decision = canSettleIn("USDC.arbitrum", quote("1.00"), { issuerFrozen: true });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("issuer_frozen");
  });

  it("REFUSES when the issuer has paused transfers", () => {
    const decision = canSettleIn("USDC.arbitrum", quote("1.00"), { issuerPaused: true });
    expect(decision.reasons).toContain("issuer_paused");
  });

  it("REFUSES an asset that is not in the registry", () => {
    // Recognised-but-refused is the point: a deposit of an unregistered token
    // can be identified and rejected rather than silently credited.
    const decision = canSettleIn("ETH.ethereum", quote("1.00"));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("not_in_registry");
  });

  it("REFUSES an asset id that does not exist at all", () => {
    // Bare "USDC" carries no settlement domain, so it can never be settled in.
    expect(canSettleIn("USDC", quote("1.00")).reasons).toContain("unknown_asset");

    // A real chain with no registry deployment — the realistic mistake. This
    // named "USDC.solana" until 38ce9bd registered it; see money.spec.ts for
    // the same correction.
    expect(canSettleIn("USDC.avalanche", quote("1.00")).reasons).toContain("unknown_asset");
  });

  it("reports every refusal, not just the first", () => {
    const decision = canSettleIn("USDC.arbitrum", null, { issuerFrozen: true, issuerPaused: true });
    expect(decision.reasons).toEqual(
      expect.arrayContaining(["peg_unknown", "issuer_frozen", "issuer_paused"])
    );
  });

  it("throws AssetNotSettleable from the money-path variant", () => {
    expect(() => assertSettleable("USDC.arbitrum", quote("0.90"))).toThrow(AssetNotSettleable);
    expect(() => assertSettleable("USDC.arbitrum", quote("1.00"))).not.toThrow();
  });
});

describe("registry integrity", () => {
  it("records an issuer-published source and a verification date for every address", () => {
    // A token address from a blog or an aggregator is how a treasury sends real
    // money to a lookalike contract, and the error is unrecoverable.
    for (const coin of STABLECOINS) {
      for (const d of coin.deployments) {
        expect(d.addressSource, d.assetId).toMatch(/^https:\/\//);
        expect(Date.parse(d.verifiedAt), d.assetId).not.toBeNaN();
      }
    }
  });

  it("uses checksummed 20-byte addresses on EVM chains", () => {
    // CHAIN-AWARE. This asserted the EVM shape for EVERY deployment, which was
    // true until 38ce9bd registered Solana USDC — a base58 SPL mint, not an
    // 0x address. The old test then failed on a correct registry entry.
    //
    // It also only checked the SHAPE despite its name. `getAddress` throws on a
    // bad EIP-55 checksum, so a transposed character in an address is now caught
    // rather than merely looking plausible — which is the failure mode that
    // matters, since a mistyped token address silently reads a different token.
    for (const coin of STABLECOINS) {
      for (const d of coin.deployments) {
        if (d.chain === "solana") {
          // Base58, 32-44 chars, excluding 0/O/I/l.
          expect(d.contractAddress, d.assetId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
        } else {
          expect(d.contractAddress, d.assetId).toMatch(/^0x[0-9a-fA-F]{40}$/);
          expect(() => getAddress(d.contractAddress), `${d.assetId} EIP-55`).not.toThrow();
          // Stored in its checksummed form, so a string compare against a
          // checksummed address from a provider does not spuriously differ.
          expect(getAddress(d.contractAddress), `${d.assetId} canonical`).toBe(d.contractAddress);
        }
      }
    }
  });

  it("every deployment records where its address came from and when", () => {
    // A token address is the one constant in this file that cannot be derived,
    // checked by a type, or caught by a unit test if it is simply wrong. The
    // provenance fields are the only thing standing between the registry and a
    // plausible-looking address nobody can trace.
    for (const coin of STABLECOINS) {
      for (const d of coin.deployments) {
        expect(d.addressSource, `${d.assetId} addressSource`).toMatch(/^https:\/\//);
        expect(d.verifiedAt, `${d.assetId} verifiedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("never lists one asset id under two coins", () => {
    const ids = STABLECOINS.flatMap((s) => s.deployments.map((d) => d.assetId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers only canonical deployments for settlement", () => {
    // A bridged representation is a claim on a bridge, not on the issuer.
    for (const assetId of settlementAssets()) {
      expect(deploymentForAsset(assetId)?.representation, assetId).toBe("canonical");
    }
  });

  it("resolves a coin and a deployment for every settlement asset", () => {
    for (const assetId of settlementAssets()) {
      expect(stablecoinForAsset(assetId), assetId).toBeDefined();
      expect(deploymentForAsset(assetId), assetId).toBeDefined();
    }
  });

  it("records freeze and pause capability rather than assuming neither", () => {
    // Both are real powers of the major fiat-backed issuers, and both are
    // business-continuity events when aimed at our own treasury.
    for (const coin of STABLECOINS) {
      expect(typeof coin.issuerCanFreeze, coin.symbol).toBe("boolean");
      expect(typeof coin.issuerCanPause, coin.symbol).toBe("boolean");
    }
  });
});

describe("concentration", () => {
  it("reports single-issuer exposure in basis points", () => {
    const c = assetConcentrationBps([
      { assetId: "USDC.arbitrum", minor: 750_000n },
      { assetId: "USDC.base", minor: 250_000n },
    ]);
    // Same issuer across two chains is ONE counterparty. A freeze or a
    // redemption halt does not respect chain boundaries.
    expect(c.USDC).toBe(10_000);
  });

  it("ignores zero and negative balances", () => {
    const c = assetConcentrationBps([
      { assetId: "USDC.arbitrum", minor: 1_000n },
      { assetId: "USDC.base", minor: 0n },
      { assetId: "USDC.polygon", minor: -5n },
    ]);
    expect(c.USDC).toBe(10_000);
  });

  it("returns nothing rather than dividing by zero on an empty treasury", () => {
    expect(assetConcentrationBps([])).toEqual({});
    expect(assetConcentrationBps([{ assetId: "USDC.base", minor: 0n }])).toEqual({});
  });
});
