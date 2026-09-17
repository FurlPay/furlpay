import { describe, it, expect } from "vitest";
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  ARC_USDC_ERC20,
  ARC_NATIVE_DECIMALS,
  ARC_ERC20_DECIMALS,
  ARC_DECIMAL_SCALE,
  ArcPrecisionError,
  assertErc20Scale,
  erc20Remainder,
  isExactInErc20,
  toErc20Units,
  toNativeUnits,
} from "../chains/arc";
import { ASSETS, Money, requireAsset } from "../money/money";
import { NETWORK_USDC } from "../x402";
import { EVM_CHAIN_IDS } from "../x402Signature";
import { EVM_CHAINS } from "../x402Chains";
import { SUPPORTED_KINDS } from "../x402Facilitator";

// ---------------------------------------------------------------------------
// Arc's two-interface USDC, pinned against a real mainnet observation.
//
// Arc is the only chain where USDC is the gas asset, and the only place in this
// codebase where "USDC" does not mean 6 decimals. One balance is exposed at 18
// decimals natively (canonical) and 6 decimals through ERC-20 (truncating).
//
// THE OBSERVATION EVERY TEST BELOW IS ANCHORED TO — https://rpc.mainnet.arc.io,
// 2026-09-17, account 0x8b1332e6414c830e823110667a6f0c10463d0f98:
//
//   eth_getBalance -> 57628035984085784575   (18dp, canonical)
//   balanceOf      ->            57628035    ( 6dp, truncated)
//
// 984085784575 base units of real money are invisible to the ERC-20 view. That
// is the entire reason this module exists, and the reason USDC.arc is stored at
// 18 decimals rather than 6.
// ---------------------------------------------------------------------------

/** The live mainnet reading this file is pinned to. */
const OBSERVED_NATIVE = 57628035984085784575n;
const OBSERVED_ERC20 = 57628035n;
const OBSERVED_DUST = 984085784575n;

describe("Arc network constants", () => {
  it("matches the chain ids read from the network", () => {
    // eth_chainId returned 0x13b2.
    expect(ARC_MAINNET_CHAIN_ID).toBe(0x13b2);
    expect(ARC_MAINNET_CHAIN_ID).toBe(5042);
    expect(ARC_TESTNET_CHAIN_ID).toBe(5042002);
  });

  it("uses the checksummed USDC interface address verified on mainnet", () => {
    // decimals() -> 6, symbol() -> "USDC" at this address.
    expect(ARC_USDC_ERC20).toBe("0x3600000000000000000000000000000000000000");
  });

  it("scales by exactly 10^12", () => {
    expect(ARC_NATIVE_DECIMALS - ARC_ERC20_DECIMALS).toBe(12);
    expect(ARC_DECIMAL_SCALE).toBe(1_000_000_000_000n);
  });
});

describe("the two interfaces describe one balance", () => {
  it("reproduces the observed mainnet pair", () => {
    expect(toErc20Units(OBSERVED_NATIVE)).toBe(OBSERVED_ERC20);
  });

  it("names the dust the ERC-20 view discards", () => {
    expect(erc20Remainder(OBSERVED_NATIVE)).toBe(OBSERVED_DUST);
    expect(isExactInErc20(OBSERVED_NATIVE)).toBe(false);
  });

  it("round-trips ERC-20 -> native -> ERC-20 exactly", () => {
    expect(toErc20Units(toNativeUnits(OBSERVED_ERC20))).toBe(OBSERVED_ERC20);
  });

  it("does NOT round-trip native -> ERC-20 -> native when dust exists", () => {
    // The lossy direction, stated as a test so nobody 'fixes' it into rounding.
    const back = toNativeUnits(toErc20Units(OBSERVED_NATIVE));
    expect(back).toBeLessThan(OBSERVED_NATIVE);
    expect(OBSERVED_NATIVE - back).toBe(OBSERVED_DUST);
  });

  it("truncates rather than rounds up", () => {
    // 1.9999995 USDC native must not become 2.000000 USDC at 6dp: rounding up
    // would invent money the ERC-20 interface cannot actually move, so a
    // balance check would pass for a transfer that then reverts.
    const justUnder = 1_999_999_500_000_000_000n;
    expect(toErc20Units(justUnder)).toBe(1_999_999n);
  });

  it("reports a zero ERC-20 balance for a non-zero native balance", () => {
    // The trap Circle's docs call out: a zero ERC-20 read does not prove the
    // account is empty.
    const dustOnly = 999_999_999_999n;
    expect(toErc20Units(dustOnly)).toBe(0n);
    expect(erc20Remainder(dustOnly)).toBe(dustOnly);
  });

  it("is exact for whole ERC-20 amounts", () => {
    expect(isExactInErc20(toNativeUnits(1_000_000n))).toBe(true);
    expect(erc20Remainder(toNativeUnits(42n))).toBe(0n);
  });
});

describe("assertErc20Scale catches a native amount in an ERC-20 sink", () => {
  it("throws on a native-scale figure", () => {
    expect(() => assertErc20Scale(OBSERVED_NATIVE, "transfer amount")).toThrow(ArcPrecisionError);
  });

  it("names the context so the caller can find the call site", () => {
    expect(() => assertErc20Scale(OBSERVED_NATIVE, "payout.amount")).toThrow(/payout\.amount/);
  });

  it("allows a plausible ERC-20 amount through unchanged", () => {
    expect(assertErc20Scale(OBSERVED_ERC20, "balance")).toBe(OBSERVED_ERC20);
    expect(assertErc20Scale(0n, "balance")).toBe(0n);
  });
});

describe("USDC.arc is registered as ONE asset, at canonical precision", () => {
  it("exists at 18 decimals on the arc chain", () => {
    const arc = requireAsset("USDC.arc");
    expect(arc.decimals).toBe(ARC_NATIVE_DECIMALS);
    expect(arc.chain).toBe("arc");
    expect(arc.symbol).toBe("USDC");
  });

  it("does not register a second ERC-20 asset for the same balance", () => {
    // Modelling native and ERC-20 USDC as two assets would double-count every
    // Arc holding — the thing Circle's docs explicitly warn against.
    const arcAssets = Object.keys(ASSETS).filter((id) => ASSETS[id as keyof typeof ASSETS].chain === "arc");
    expect(arcAssets).toEqual(["USDC.arc"]);
  });

  it("refuses to add Arc USDC to another chain's USDC", () => {
    const arc = Money.parse("1.5", requireAsset("USDC.arc"));
    const arb = Money.parse("1.5", requireAsset("USDC.arbitrum"));
    expect(() => arc.plus(arb)).toThrow();
  });

  it("parses decimal places the 6dp assets would reject", () => {
    // 1e-18 USDC is representable on Arc and nowhere else in this registry.
    const tiny = Money.parse("0.000000000000000001", requireAsset("USDC.arc"));
    expect(tiny.minor).toBe(1n);
    expect(() => Money.parse("0.000000000000000001", requireAsset("USDC.arbitrum"))).toThrow();
  });
});

describe("Arc is wired into x402 as a verifiable — but not yet advertised — network", () => {
  it("has the chain ids read from both live RPCs", () => {
    expect(EVM_CHAIN_IDS.arc).toBe(ARC_MAINNET_CHAIN_ID);
    expect(EVM_CHAIN_IDS["arc-testnet"]).toBe(ARC_TESTNET_CHAIN_ID);
  });

  it("has a viem chain definition whose native currency is 18dp USDC", () => {
    // viem estimates fees in NATIVE units, so this must stay 18 even though
    // every x402 amount on Arc is 6dp. Conflating the two is the 10^12 bug.
    for (const key of ["arc", "arc-testnet"] as const) {
      const chain = EVM_CHAINS[key];
      expect(chain.nativeCurrency.symbol).toBe("USDC");
      expect(chain.nativeCurrency.decimals).toBe(ARC_NATIVE_DECIMALS);
    }
    expect(EVM_CHAINS.arc.id).toBe(ARC_MAINNET_CHAIN_ID);
    expect(EVM_CHAINS["arc-testnet"].id).toBe(ARC_TESTNET_CHAIN_ID);
  });

  it("settles x402 through the 6-decimal ERC-20 interface", () => {
    // transferWithAuthorization is an ERC-20 function, so an x402 amount on Arc
    // is 6dp like every other network — NOT 18. Pinned so nobody 'fixes'
    // atomicAmount() into an 18dp special case for Arc.
    expect(NETWORK_USDC.arc).toBe(ARC_USDC_ERC20);
    expect(NETWORK_USDC["arc-testnet"]).toBe(ARC_USDC_ERC20);
    expect(ARC_ERC20_DECIMALS).toBe(6);
  });

  it("is NOT advertised on /supported until a testnet settlement is proven", () => {
    // Arc can be VERIFIED (EVM_CHAIN_IDS entry + standard EIP-712 domain,
    // confirmed by matching the contract's DOMAIN_SEPARATOR). It is not yet
    // advertised, because no settlement has been driven end-to-end on Arc.
    // Advertising ahead of that is exactly the Solana mistake — see
    // railAdvertising.spec.ts. Add "arc" to NETWORKS in the same commit that
    // records a verified Arc testnet settlement, not before.
    expect(SUPPORTED_KINDS.map((k) => k.network)).not.toContain("arc");
  });
});
