// Registry tests.
//
// These exist because of a specific, already-committed class of error. The
// previous registry had Celo at CCTP domain 8 and Linea at 9 — domain 8 is Sui,
// domain 9 is Aptos, and Celo has no CCTP deployment at all. Nothing caught it,
// because a wrong domain does not throw: it produces a real cross-chain alert
// naming the wrong destination chain, which reads as perfectly plausible output.
//
// So the assertions below are mostly about pinning facts that have an external
// source of truth, in a form that fails loudly if somebody "tidies" them.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CCTP_DOMAINS,
  CCTP_V2_TOKEN_MESSENGER,
  CCTP_V2_MESSAGE_TRANSMITTER,
  CCTP_V2_OVERRIDES,
  USDC_ASSETS,
  cctpContractsFor,
  cctpDomainName,
  getAllUsdcAssets,
  getChainByCctpDomain,
  getEvmScanAssets,
  isCctpContract,
  isNativeUsdc,
  TOPIC_CCTP_V2_DEPOSIT_FOR_BURN,
  TOPIC_CCTP_V2_MESSAGE_RECEIVED,
  TOPIC_ERC20_TRANSFER,
} from "./registry.js";

test("native USDC is matched only on the exact verified contract", () => {
  assert.ok(isNativeUsdc("ethereum", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"));
  // Checksummed input must still match — providers are inconsistent about case.
  assert.ok(isNativeUsdc("ethereum", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"));
  assert.ok(isNativeUsdc("ethereum", "  0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48  "));
});

test("bridged and lookalike USDC is rejected", () => {
  // USDC.e on Arbitrum. Real contract, real "USDC" symbol, NOT native USDC —
  // this is the exact token a symbol-based check would wrongly accept.
  assert.equal(isNativeUsdc("arbitrum", "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8"), false);
  // Another chain's native USDC is not this chain's.
  assert.equal(isNativeUsdc("ethereum", USDC_ASSETS.base!.contractOrMint), false);
  // An unknown chain must never fall back to accepting anything.
  assert.equal(isNativeUsdc("fantom", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), false);
});

test("Solana mints are compared case-sensitively", () => {
  const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  assert.ok(isNativeUsdc("solana", mint));
  // base58 is case-sensitive: lowercasing produces a different string, which must
  // not be treated as the same mint.
  assert.equal(isNativeUsdc("solana", mint.toLowerCase()), false);
});

test("CCTP domain IDs match Circle's published list", () => {
  // The three that were previously wrong, plus the anchors around them.
  assert.equal(USDC_ASSETS.linea!.cctpDomain, 11, "Linea is 11, not 9 (9 is Aptos)");
  assert.equal(USDC_ASSETS.sonic!.cctpDomain, 13, "Sonic is 13, not unset");
  assert.equal(USDC_ASSETS.celo!.cctpDomain, null, "Celo has native USDC but no CCTP");

  assert.equal(USDC_ASSETS.ethereum!.cctpDomain, 0);
  assert.equal(USDC_ASSETS.avalanche!.cctpDomain, 1);
  assert.equal(USDC_ASSETS.optimism!.cctpDomain, 2);
  assert.equal(USDC_ASSETS.arbitrum!.cctpDomain, 3);
  assert.equal(USDC_ASSETS.solana!.cctpDomain, 5);
  assert.equal(USDC_ASSETS.base!.cctpDomain, 6);
  assert.equal(USDC_ASSETS.polygon!.cctpDomain, 7);
  assert.equal(USDC_ASSETS.unichain!.cctpDomain, 10);
  assert.equal(USDC_ASSETS.worldchain!.cctpDomain, 14);
});

test("the domain table names the chains our registry does not cover", () => {
  // Reserved domains that must never be claimed by a chain we do track.
  assert.equal(CCTP_DOMAINS[4]!.name, "Noble");
  assert.equal(CCTP_DOMAINS[8]!.name, "Sui");
  assert.equal(CCTP_DOMAINS[9]!.name, "Aptos");
  // A burn heading somewhere unscanned still gets a real name.
  assert.equal(cctpDomainName(22), "Plume");
  assert.equal(cctpDomainName(26), "Arc");
  // And an unknown domain reads as unknown rather than as a name.
  assert.equal(cctpDomainName(999), "domain:999");
});

test("BNB Smart Chain is a CCTP domain without native USDC", () => {
  // The instructive case for the native/CCTP distinction: CCTP V2 supports it,
  // Circle's native-USDC contract list does not include it.
  assert.equal(CCTP_DOMAINS[17]!.native, false);
  assert.equal(getChainByCctpDomain(17), null);
});

test("no two chains claim the same CCTP domain", () => {
  const seen = new Map<number, string>();
  for (const a of getAllUsdcAssets()) {
    if (a.cctpDomain === null) continue;
    const prior = seen.get(a.cctpDomain);
    assert.equal(prior, undefined, `domain ${a.cctpDomain} claimed by both ${prior} and ${a.chainSlug}`);
    seen.set(a.cctpDomain, a.chainSlug);
  }
});

test("every chain's CCTP domain exists in the domain table", () => {
  for (const a of getAllUsdcAssets()) {
    if (a.cctpDomain === null) continue;
    assert.ok(
      CCTP_DOMAINS[a.cctpDomain],
      `${a.chainSlug} claims domain ${a.cctpDomain}, which the domain table does not list`
    );
  }
});

test("domain lookup round-trips", () => {
  for (const a of getAllUsdcAssets()) {
    if (a.cctpDomain === null) continue;
    assert.equal(getChainByCctpDomain(a.cctpDomain), a.chainSlug);
  }
});

test("CCTP contracts are the canonical pair except where overridden", () => {
  const base = cctpContractsFor("base");
  assert.equal(base?.tokenMessenger, CCTP_V2_TOKEN_MESSENGER);
  assert.equal(base?.messageTransmitter, CCTP_V2_MESSAGE_TRANSMITTER);

  // EDGE (domain 28) is the one chain that is not at the canonical addresses.
  assert.notEqual(CCTP_V2_OVERRIDES[28]!.tokenMessenger, CCTP_V2_TOKEN_MESSENGER);

  // A chain with no CCTP deployment must return null, not the canonical pair —
  // otherwise the scanner would read Celo logs at an address holding nothing and
  // report clean empty scans forever.
  assert.equal(cctpContractsFor("celo"), null);
  assert.equal(cctpContractsFor("zksync"), null);
});

test("CCTP contract addresses are recognised, ordinary ones are not", () => {
  assert.ok(isCctpContract(CCTP_V2_TOKEN_MESSENGER));
  assert.ok(isCctpContract(CCTP_V2_TOKEN_MESSENGER.toUpperCase().replace("0X", "0x")));
  assert.ok(isCctpContract(CCTP_V2_MESSAGE_TRANSMITTER));
  assert.ok(isCctpContract(CCTP_V2_OVERRIDES[28]!.tokenMessenger));
  // Solana program IDs are base58 and case-sensitive.
  assert.ok(isCctpContract("CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"));
  // USDC itself is not a CCTP contract.
  assert.equal(isCctpContract(USDC_ASSETS.ethereum!.contractOrMint), false);
  assert.equal(isCctpContract("0x0000000000000000000000000000000000000000"), false);
});

test("event topics are 32-byte hashes and distinct", () => {
  const topics = [
    TOPIC_ERC20_TRANSFER,
    TOPIC_CCTP_V2_DEPOSIT_FOR_BURN,
    TOPIC_CCTP_V2_MESSAGE_RECEIVED,
  ];
  for (const t of topics) {
    assert.match(t, /^0x[0-9a-f]{64}$/, `${t} is not a lowercase 32-byte hex hash`);
  }
  assert.equal(new Set(topics).size, topics.length, "topic collision");
  // Pinned exactly: read off a live Base log, and the value a copy/paste slip
  // would silently change.
  assert.equal(
    TOPIC_ERC20_TRANSFER,
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
  );
});

test("every registry entry is internally consistent", () => {
  for (const [slug, a] of Object.entries(USDC_ASSETS)) {
    assert.equal(a.chainSlug, slug, `key ${slug} disagrees with chainSlug ${a.chainSlug}`);
    assert.ok(a.circleVerified, `${slug} is in the registry without being Circle-verified`);
    assert.ok(a.isNative, `${slug} is in the registry without being native USDC`);
    // Every USDC deployment Circle documents uses 6 decimals. An entry claiming
    // otherwise is far more likely a typo than a new fact, and `usdc verify`
    // checks it against the chain.
    assert.equal(a.decimals, 6, `${slug} claims ${a.decimals} decimals`);
    assert.ok(a.txUrlPrefix.startsWith("https://"), `${slug} has a non-https explorer`);
    assert.ok(a.txUrlPrefix.endsWith("/"), `${slug} tx prefix would concatenate badly`);

    if (a.kind === "evm") {
      assert.match(a.contractOrMint, /^0x[0-9a-f]{40}$/, `${slug} contract is not a lowercase address`);
      assert.ok(a.chainId !== null, `${slug} is EVM without a chain ID`);
    }
  }
});

test("a scannable EVM chain has somewhere to read from", () => {
  for (const a of getEvmScanAssets()) {
    assert.ok(
      a.publicRpc.length > 0 || a.alchemySubdomain !== null,
      `${a.chainSlug} is marked scannable with no endpoint — it would report empty scans forever`
    );
  }
});
