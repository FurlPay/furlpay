import test from "node:test";
import assert from "node:assert/strict";
import { Gateway } from "../dist/index.js";

// ---------------------------------------------------------------------------
// Asset/network binding — the Phase 1 defect #2 regression suite.
//
// THE DEFECT THIS FILE EXISTS FOR. `Gateway`'s constructor read:
//
//     const asset = opts.asset ?? NETWORK_USDC[this.network];
//
// A caller-supplied `asset` bypassed the network map entirely and nothing
// checked that the two agreed. `{ network: "solana-devnet", asset: <mainnet
// mint> }` constructed happily and would have quoted, bound and settled a
// payment naming a mainnet asset on a devnet rail.
//
// It was reachable in practice rather than theoretically: "solana-devnet" was
// absent from NETWORK_USDC (while both EVM testnets were present), so the
// devnet rail HAD to pass `asset` explicitly — the one path that skipped the
// only lookup that could have caught the mismatch.
//
// Every test below fails against the pre-change implementation.
// ---------------------------------------------------------------------------

const SECRET = "test_secret_at_least_16_chars_long";
const PAY_TO = "FurLPayTestMerchantAddress1111111111111111";

const SOLANA_MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const BASE_MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ARBITRUM_MAINNET_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

const base = { payTo: PAY_TO, quoteSecret: SECRET, price: () => 0.001 };

test("a mainnet asset on a devnet network is refused", () => {
  // THE HEADLINE CASE. Pre-change this constructed without complaint.
  assert.throws(
    () => new Gateway({ ...base, network: "solana-devnet", asset: SOLANA_MAINNET_USDC }),
    /belongs to solana:mainnet-beta|declares/i,
    "a mainnet mint must not be usable on the devnet rail"
  );
});

test("a devnet asset on a mainnet network is refused", () => {
  // The mirror. Less catastrophic — it loses a payment rather than moving real
  // money — but it is the same missing check.
  assert.throws(
    () => new Gateway({ ...base, network: "solana", asset: SOLANA_DEVNET_USDC }),
    /belongs to solana:devnet|declares/i
  );
});

test("an asset from another chain entirely is refused", () => {
  // An EVM contract address on a Solana rail. Nothing about the old code
  // prevented this; the address was simply copied into the quote.
  assert.throws(
    () => new Gateway({ ...base, network: "solana", asset: BASE_MAINNET_USDC }),
    /belongs to base:mainnet|declares/i
  );
});

test("an asset from a sibling EVM chain is refused", () => {
  // Arbitrum USDC and Base USDC are different contracts on different chains.
  // Symbol-based reasoning treats them as one asset; identity does not.
  assert.throws(
    () => new Gateway({ ...base, network: "base", asset: ARBITRUM_MAINNET_USDC }),
    /belongs to arbitrum:mainnet|declares/i
  );
});

test("an unregistered address is refused rather than trusted", () => {
  // The old code accepted ANY string as an asset. An attacker-supplied token
  // address would have been quoted and bound as though it were canonical.
  assert.throws(
    () => new Gateway({ ...base, network: "base", asset: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }),
    /no asset registered/i
  );
});

test("the correct asset for each network is accepted", () => {
  // The fix must not be a blanket refusal.
  const ok = [
    ["solana", SOLANA_MAINNET_USDC],
    ["solana-devnet", SOLANA_DEVNET_USDC],
    ["base", BASE_MAINNET_USDC],
    ["arbitrum", ARBITRUM_MAINNET_USDC],
  ];
  for (const [network, asset] of ok) {
    assert.doesNotThrow(
      () => new Gateway({ ...base, network, asset }),
      `${asset} should be valid on ${network}`
    );
  }
});

test("solana-devnet resolves its asset without one being supplied", () => {
  // THE ROOT CAUSE. "solana-devnet" was missing from NETWORK_USDC, so omitting
  // `asset` threw "no canonical USDC address known" — which is what forced
  // examples/agent-paid-api to hardcode DEVNET_USDC_MINT and created the second
  // source of truth. Both EVM testnets already worked; only Solana did not.
  const gw = new Gateway({ ...base, network: "solana-devnet" });
  assert.ok(gw, "the devnet rail must be configurable without a hardcoded mint");
});

test("every supported network resolves a canonical asset unaided", () => {
  for (const network of ["solana", "solana-devnet", "base", "base-sepolia", "arbitrum", "arbitrum-sepolia", "polygon"]) {
    assert.doesNotThrow(
      () => new Gateway({ ...base, network }),
      `network "${network}" must resolve its own canonical stablecoin`
    );
  }
});

test("an unsupported network is refused at construction, not at settlement", () => {
  assert.throws(
    () => new Gateway({ ...base, network: "ethereum-classic" }),
    /network/i,
    "an unknown network must fail fast rather than produce an unquotable gateway"
  );
});

test("the resolved asset is exposed for the quote and matches the registry", () => {
  // The quote the agent signs must name the asset the gateway resolved — not a
  // symbol, and not whatever the caller passed.
  const gw = new Gateway({ ...base, network: "solana-devnet" });
  assert.equal(gw.assetAddress, SOLANA_DEVNET_USDC);
  assert.equal(gw.assetDecimals, 6);
  assert.equal(gw.canonicalNetwork, "solana:devnet");
});
