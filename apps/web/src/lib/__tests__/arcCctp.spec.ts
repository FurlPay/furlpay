import { describe, it, expect } from "vitest";
import { CCTP_DOMAINS, CCTP_USDC } from "../services/cctpExecution";
import { isCctpSupported } from "../services/cctp";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, ARC_USDC_ERC20 } from "../chains/arc";
import { CHAIN_REGISTRY } from "../services/chainRegistry";

// ---------------------------------------------------------------------------
// Arc CCTP wiring, pinned to values VERIFIED ON ARC MAINNET 2026-09-25.
//
// Every constant asserted here was read from the chain, not from a table:
//
//   eth_chainId                                        -> 0x13b2 (5042)
//   USDC(0x3600…0000).decimals()                       -> 6
//   USDC(0x3600…0000).symbol()                         -> "USDC"
//   MessageTransmitterV2(0x81D4…4B64).localDomain()    -> 0x1a (26)
//   TokenMessengerV2(0x28b5…cf5d).localMinter()        -> 0xfd78…D002
//   TokenMinterV2(0xfd78…D002)
//     .burnLimitsPerMessage(0x3600…0000)               -> 10_000_000e6
//
// That last one is the load-bearing check. A domain in a table only proves
// Circle intends to support the chain; a non-zero burn limit proves the token
// is a registered local token and the burn leg will actually resolve.
// ---------------------------------------------------------------------------

describe("Arc CCTP domain", () => {
  it("is 26, matching MessageTransmitterV2.localDomain() on Arc mainnet", () => {
    expect(CCTP_DOMAINS.arc).toBe(26);
  });

  it("does not collide with any other chain's domain", () => {
    // A duplicated domain is the worst possible bug on this path: the burn
    // would name the wrong destination and the USDC would mint on another
    // chain entirely, with a valid attestation and no error anywhere.
    const domains = Object.values(CCTP_DOMAINS).filter((d): d is number => d !== undefined);
    expect(new Set(domains).size).toBe(domains.length);
  });
});

describe("Arc CCTP USDC", () => {
  it("is the precompile-shaped ERC-20 interface address", () => {
    expect(CCTP_USDC.arc).toBe(ARC_USDC_ERC20);
  });

  it("is NOT any other chain's USDC", () => {
    // Explicitly required: an Ethereum/Arbitrum/Base/Polygon USDC address is
    // meaningless on Arc, and approving one would approve nothing while the
    // burn reverts.
    const others = Object.entries(CCTP_USDC)
      .filter(([chain]) => chain !== "arc")
      .map(([, addr]) => addr);
    expect(others).not.toContain(CCTP_USDC.arc);
  });

  it("every configured USDC address is unique across chains", () => {
    const addrs = Object.values(CCTP_USDC).filter(Boolean) as string[];
    expect(new Set(addrs.map((a) => a.toLowerCase())).size).toBe(addrs.length);
  });
});

describe("quote and execute agree about Arc", () => {
  // The two lists drifting apart is a documented hazard in cctp.ts: a chain
  // quoted but not executable gets planned, priced and promised at a 20s ETA,
  // then refused by /api/intents/cctp, and never falls back to Li.Fi.
  it("Arc is quotable and executable, or neither", () => {
    expect(isCctpSupported("arc")).toBe(CCTP_DOMAINS.arc !== undefined);
  });

  it("every executable chain is also quotable", () => {
    for (const chain of Object.keys(CCTP_DOMAINS)) {
      expect(isCctpSupported(chain as never)).toBe(true);
    }
  });

  it("every quotable chain has both a domain and a burn token", () => {
    for (const chain of Object.keys(CCTP_DOMAINS)) {
      expect(CCTP_USDC[chain as never]).toBeDefined();
    }
  });
});

describe("Arc chain identity cannot be confused with another network", () => {
  it("mainnet and testnet chain IDs differ", () => {
    expect(ARC_MAINNET_CHAIN_ID).not.toBe(ARC_TESTNET_CHAIN_ID);
  });

  it("the registry's Arc entries carry the verified chain IDs", () => {
    const arc = CHAIN_REGISTRY.find((c) => c.id === "arc");
    const arcTestnet = CHAIN_REGISTRY.find((c) => c.id === "arc-testnet");
    expect(arc?.chainId).toBe(ARC_MAINNET_CHAIN_ID);
    expect(arcTestnet?.chainId).toBe(ARC_TESTNET_CHAIN_ID);
  });

  it("no two EVM registry entries share a chainId", () => {
    // Scoped to EVM deliberately. `solana` and `solana-devnet` both carry
    // chainId 0 because Solana has no EIP-155 id at all — a placeholder, not a
    // collision. Asserting global uniqueness flagged that as a duplicate and
    // would have sent someone looking for a bug that does not exist.
    const ids = CHAIN_REGISTRY.filter((c) => c.vm === "evm").map((c) => c.chainId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only the known USDC-gas chains claim USDC as their native token", () => {
    // Arc is NOT the only one: Tempo (4217) pays gas in TIP-20 stablecoins and
    // is also labelled nativeToken "USDC". The two are different mechanisms
    // wearing the same label — on Arc, USDC *is* the native balance exposed at
    // 18dp natively and 6dp through ERC-20; on Tempo, USDC.e (0x20C0…) is an
    // ordinary bridged ERC-20. Only Arc has the dual-interface decimal hazard
    // that lib/chains/arc.ts exists to handle.
    //
    // This list is a tripwire: a NEW chain labelled USDC-gas fails here, so
    // someone has to decide which of those two models it follows rather than
    // silently inheriting Arc's 10^12 scaling.
    const usdcGas = CHAIN_REGISTRY.filter((c) => c.nativeToken === "USDC").map((c) => c.id);
    expect(usdcGas.sort()).toEqual(["arc", "arc-testnet", "tempo", "tempo-testnet"]);
  });
});
