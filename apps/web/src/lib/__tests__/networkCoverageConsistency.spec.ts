import { describe, it, expect } from "vitest";
import { SUPPORTED_KINDS } from "@/lib/x402Facilitator";
import { canVerifySignature, EVM_CHAIN_IDS } from "@/lib/x402Signature";
import { EVM_CHAINS } from "@/lib/x402Chains";
import { resolveSettlementAsset } from "@/lib/x402Assets";
import { RAIL_MATRIX, networkSpec, selectableForLive, liveRails } from "@furlpay/control-plane";

// ---------------------------------------------------------------------------
// Four separate registries name networks, and they must not drift apart.
//
//   1. EVM_CHAIN_IDS      — networks whose SIGNATURES can be verified   (8)
//   2. EVM_CHAINS         — networks with a viem chain + RPC transport  (8)
//   3. settlementAssets   — networks with a PINNED token contract       (3)
//   4. SUPPORTED_KINDS    — what /facilitator/supported ADVERTISES      (3)
//
// The gap between 1 and 3 is the interesting one and it is deliberate: being
// able to check a signature on Polygon says nothing about being able to settle
// there, because settling requires a pinned asset (F-7) and there is none. The
// danger is advertising the larger number. `/supported` is what clients read to
// choose a facilitator, so a network listed there and unsettleable in practice
// is a promise the system cannot keep.
//
// THE RULE THIS FILE ENFORCES: /supported ⊆ (verifiable ∩ pinned). Anything in
// the advertised set must be checkable AND settleable, and nothing may be
// advertised on the strength of one without the other.
//
// A SEPARATE NAMESPACE, DELIBERATELY NOT UNIFIED. The control plane's own
// registry (`networkSpec`) uses `arbitrum_one` / `base_sepolia`; the x402
// facilitator uses `arbitrum` / `arbitrum-sepolia`. These are two different
// vocabularies belonging to two different protocols, and they are NOT aliases
// of each other. Silently coercing between them is how a payment authorized for
// one chain gets settled on another, so the mismatch is pinned here rather than
// papered over — a name that fails to resolve fails closed, which is correct.
// ---------------------------------------------------------------------------

const advertised = [...new Set(SUPPORTED_KINDS.map((k) => k.network))].sort();

/** A network is "pinned" when at least one asset resolves for it. */
function hasPinnedAsset(network: string): boolean {
  // USDC on each supported network. `resolveSettlementAsset` refuses anything
  // not in the per-network allowlist, so a network with no entry cannot pass
  // for any address at all.
  const probes: Record<string, string> = {
    arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "arbitrum-sepolia": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  };
  const address = probes[network];
  if (!address) return false;
  return resolveSettlementAsset(network, address).ok;
}

describe("the advertised set is the intersection, never the union", () => {
  it("advertises exactly three networks", () => {
    // Stated as a number so that widening it is a deliberate edit with a
    // failing test attached, not a drive-by addition.
    expect(advertised).toEqual(["arbitrum", "arbitrum-sepolia", "base"]);
  });

  it("every advertised network can have its signatures verified", () => {
    for (const n of advertised) {
      expect(canVerifySignature(n), `${n} is advertised but has no signature verifier`).toBe(true);
    }
  });

  it("every advertised network has a viem chain and an RPC transport", () => {
    for (const n of advertised) {
      expect(EVM_CHAINS[n], `${n} is advertised but has no chain entry`).toBeTruthy();
      expect(EVM_CHAIN_IDS[n], `${n} is advertised but has no chain id`).toBeTruthy();
    }
  });

  it("every advertised network has a PINNED settlement asset", () => {
    // The load-bearing one. Without a pinned asset the facilitator cannot name
    // a token to settle against, so advertising the network promises something
    // it cannot do.
    for (const n of advertised) {
      expect(hasPinnedAsset(n), `${n} is advertised but has no pinned asset`).toBe(true);
    }
  });

  it("a network that can be VERIFIED but not SETTLED is NOT advertised", () => {
    // polygon, ethereum, arc, arc-testnet and base-sepolia all have signature
    // verifiers. None has a pinned asset. None may appear in /supported.
    const verifiable = Object.keys(EVM_CHAIN_IDS);
    const unsettleable = verifiable.filter((n) => !hasPinnedAsset(n));
    expect(unsettleable.length, "the two registries were expected to differ").toBeGreaterThan(0);
    for (const n of unsettleable) {
      expect(advertised, `${n} is advertised but cannot be settled`).not.toContain(n);
    }
  });

  it("an unpinned network is refused at asset resolution, whatever address is presented", () => {
    // Fail-closed proof rather than absence-of-entry proof: even a legitimate
    // USDC address on an unlisted network does not resolve.
    for (const n of ["polygon", "ethereum", "arc", "arc-testnet", "base-sepolia"]) {
      const r = resolveSettlementAsset(n, "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"); // USDC on Polygon
      expect(r.ok, `${n} resolved an asset it should not know about`).toBe(false);
    }
  });

  it("both x402 protocol versions advertise the SAME network set", () => {
    // A v1/v2 asymmetry would let a client negotiate down to a version that
    // offers a network the other cannot settle.
    const byVersion = new Map<unknown, string[]>();
    for (const k of SUPPORTED_KINDS) {
      const list = byVersion.get(k.x402Version) ?? [];
      list.push(k.network);
      byVersion.set(k.x402Version, list);
    }
    expect(byVersion.size).toBeGreaterThanOrEqual(2);
    const sets = [...byVersion.values()].map((v) => [...v].sort().join(","));
    expect(new Set(sets).size, "x402 versions advertise different networks").toBe(1);
  });
});

describe("the control-plane rail registry is internally consistent", () => {
  it("every network named by a rail resolves in the control plane's own registry", () => {
    // A typo'd network on a rail is invisible: the rail simply never matches,
    // and a payment that should have been eligible is refused for a reason
    // nobody can see. Catch it here instead.
    for (const rail of RAIL_MATRIX) {
      for (const n of rail.networks) {
        expect(networkSpec(n), `rail ${rail.railId} names unknown network "${n}"`).toBeTruthy();
      }
    }
  });

  it("no rail is selectable for live value", () => {
    // The claim the whole audit rests on. `liveRails()` must stay empty until a
    // settlement has actually been observed.
    expect(liveRails()).toEqual([]);
    for (const rail of RAIL_MATRIX) {
      expect(
        selectableForLive(rail),
        `${rail.railId} reports itself selectable for live value`
      ).toBe(false);
    }
  });

  it("the x402 and control-plane vocabularies are genuinely distinct", () => {
    // Documented, not fixed. `arbitrum_one` and `arbitrum` are different
    // strings belonging to different protocols; nothing coerces between them,
    // and an unresolvable name fails closed. This test exists so that a future
    // change which starts treating them as aliases has to break it first.
    expect(networkSpec("arbitrum_one")).toBeTruthy();
    expect(networkSpec("arbitrum"), "the control plane started accepting an x402 name").toBeNull();
    expect(EVM_CHAIN_IDS["arbitrum"]).toBeTruthy();
    expect(EVM_CHAIN_IDS["arbitrum_one"], "x402 started accepting a control-plane name").toBeUndefined();
  });

  it("a rail naming a network the x402 facilitator cannot settle is not thereby live", () => {
    // `stablecoin_cctp` lists seven networks including solana. None of that
    // makes it selectable, because access is what gates selection — not the
    // breadth of the network list.
    const wide = RAIL_MATRIX.find((r) => r.networks.length > 3);
    expect(wide, "expected at least one broad rail").toBeTruthy();
    expect(selectableForLive(wide!)).toBe(false);
  });
});

describe("Solana is absent from every settlement surface, on purpose", () => {
  it("is not advertised by the facilitator", () => {
    expect(advertised).not.toContain("solana");
  });

  it("cannot have a signature verified, and says so explicitly", () => {
    // "Not checked" must never be recorded as "checked and valid".
    expect(canVerifySignature("solana")).toBe(false);
  });

  it("has no pinned settlement asset", () => {
    expect(hasPinnedAsset("solana")).toBe(false);
  });
});
