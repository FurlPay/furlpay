// Circle native-USDC and CCTP V2 registry.
//
// PROVENANCE. Every address, domain ID and event topic in this file was taken
// from Circle's own documentation or read back off a live chain on 2026-09-29.
// None of it is recalled from memory, because the cost of being wrong here is
// silent: a mistyped contract means the scanner reports zero transfers on a busy
// chain, which is indistinguishable from a quiet market, and a mistyped domain
// means a cross-chain transfer is attributed to the wrong chain entirely.
//
//   native USDC contracts   developers.circle.com/stablecoins/usdc-contract-addresses
//   CCTP domains + version  developers.circle.com/cctp/cctp-supported-blockchains
//   CCTP V2 contracts       developers.circle.com/cctp/evm-smart-contracts
//   event topic0 hashes     read from live Base logs — see EVENT TOPICS below
//
// WHAT WAS WRONG BEFORE, so it is not reintroduced. The previous version of this
// file had Celo at CCTP domain 8 and Linea at 9. Domain 8 is Sui and domain 9 is
// Aptos; Celo has native USDC but no CCTP deployment at all, and Linea is 11.
// Sonic was recorded as having no domain when it is 13. Those three errors would
// have mislabelled the destination chain of real cross-chain transfers.
//
// VERIFICATION RULE. A transfer is ingested only when its contract or mint
// matches `contractOrMint` for that chain. Matching on `symbol == "USDC"` is
// never acceptable — bridged variants (USDC.e) and outright lookalikes both
// carry that symbol, and counting them would inflate every figure downstream.

import type { UsdcAsset } from "./types.js";

/* ------------------------------------------------------------------ */
/* Native USDC assets                                                  */
/* ------------------------------------------------------------------ */

/**
 * Chains whose native USDC contract is verified AND which this tracker can
 * actually read.
 *
 * `scan` is the honest part of this table. It is true only where a public RPC
 * endpoint was probed and answered with the right chain ID, so `doctor` can
 * report coverage without overstating it. A chain present here with `scan:
 * false` is one whose address we trust but whose logs we are not reading.
 */
export const USDC_ASSETS: Record<string, UsdcAsset> = {
  ethereum: {
    chainSlug: "ethereum",
    chainName: "Ethereum",
    chainId: 1,
    kind: "evm",
    contractOrMint: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    cctpDomain: 0,
    explorerUrl: "https://etherscan.io",
    txUrlPrefix: "https://etherscan.io/tx/",
    addressUrlPrefix: "https://etherscan.io/address/",
    alchemySubdomain: "eth-mainnet",
    publicRpc: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
    scan: true,
  },
  avalanche: {
    chainSlug: "avalanche",
    chainName: "Avalanche C-Chain",
    chainId: 43114,
    kind: "evm",
    contractOrMint: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    cctpDomain: 1,
    explorerUrl: "https://snowtrace.io",
    txUrlPrefix: "https://snowtrace.io/tx/",
    addressUrlPrefix: "https://snowtrace.io/address/",
    alchemySubdomain: "avax-mainnet",
    publicRpc: ["https://avalanche-c-chain-rpc.publicnode.com"],
    scan: true,
  },
  optimism: {
    chainSlug: "optimism",
    chainName: "OP Mainnet",
    chainId: 10,
    kind: "evm",
    contractOrMint: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    cctpDomain: 2,
    explorerUrl: "https://optimistic.etherscan.io",
    txUrlPrefix: "https://optimistic.etherscan.io/tx/",
    addressUrlPrefix: "https://optimistic.etherscan.io/address/",
    alchemySubdomain: "opt-mainnet",
    publicRpc: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
    scan: true,
  },
  arbitrum: {
    chainSlug: "arbitrum",
    chainName: "Arbitrum One",
    chainId: 42161,
    kind: "evm",
    contractOrMint: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    cctpDomain: 3,
    explorerUrl: "https://arbiscan.io",
    txUrlPrefix: "https://arbiscan.io/tx/",
    addressUrlPrefix: "https://arbiscan.io/address/",
    alchemySubdomain: "arb-mainnet",
    publicRpc: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
    scan: true,
  },
  solana: {
    chainSlug: "solana",
    chainName: "Solana",
    chainId: null,
    kind: "solana",
    contractOrMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    cctpDomain: 5,
    explorerUrl: "https://solscan.io",
    txUrlPrefix: "https://solscan.io/tx/",
    addressUrlPrefix: "https://solscan.io/account/",
    alchemySubdomain: null,
    publicRpc: [],
    // Solana is scanned, but per tracked address rather than chain-wide — a
    // full SPL firehose needs Geyser, which is not on the free tier. See
    // solanaScanner.ts, which says so in its own header.
    scan: true,
  },
  base: {
    chainSlug: "base",
    chainName: "Base",
    chainId: 8453,
    kind: "evm",
    contractOrMint: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    cctpDomain: 6,
    explorerUrl: "https://basescan.org",
    txUrlPrefix: "https://basescan.org/tx/",
    addressUrlPrefix: "https://basescan.org/address/",
    alchemySubdomain: "base-mainnet",
    publicRpc: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
    scan: true,
  },
  polygon: {
    chainSlug: "polygon",
    chainName: "Polygon PoS",
    chainId: 137,
    kind: "evm",
    contractOrMint: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    cctpDomain: 7,
    explorerUrl: "https://polygonscan.com",
    txUrlPrefix: "https://polygonscan.com/tx/",
    addressUrlPrefix: "https://polygonscan.com/address/",
    alchemySubdomain: "polygon-mainnet",
    publicRpc: ["https://polygon-bor-rpc.publicnode.com"],
    scan: true,
  },
  unichain: {
    chainSlug: "unichain",
    chainName: "Unichain",
    chainId: 130,
    kind: "evm",
    contractOrMint: "0x078d782b760474a361dda0af3839290b0ef57ad6",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    cctpDomain: 10,
    explorerUrl: "https://uniscan.xyz",
    txUrlPrefix: "https://uniscan.xyz/tx/",
    addressUrlPrefix: "https://uniscan.xyz/address/",
    alchemySubdomain: "unichain-mainnet",
    publicRpc: ["https://unichain-rpc.publicnode.com", "https://mainnet.unichain.org"],
    scan: true,
  },
  linea: {
    chainSlug: "linea",
    chainName: "Linea",
    chainId: 59144,
    kind: "evm",
    contractOrMint: "0x176211869ca2b568f2a7d4ee941e073a821ee1ff",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    // 11, not 9. Domain 9 is Aptos.
    cctpDomain: 11,
    explorerUrl: "https://lineascan.build",
    txUrlPrefix: "https://lineascan.build/tx/",
    addressUrlPrefix: "https://lineascan.build/address/",
    alchemySubdomain: "linea-mainnet",
    publicRpc: ["https://linea-rpc.publicnode.com", "https://rpc.linea.build"],
    scan: true,
  },
  sonic: {
    chainSlug: "sonic",
    chainName: "Sonic",
    chainId: 146,
    kind: "evm",
    contractOrMint: "0x29219dd400f2bf60e5a23d13be72b486d4038894",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    // 13. Previously recorded as having no CCTP domain.
    cctpDomain: 13,
    explorerUrl: "https://sonicscan.org",
    txUrlPrefix: "https://sonicscan.org/tx/",
    addressUrlPrefix: "https://sonicscan.org/address/",
    alchemySubdomain: "sonic-mainnet",
    publicRpc: ["https://sonic-rpc.publicnode.com"],
    scan: true,
  },
  worldchain: {
    chainSlug: "worldchain",
    chainName: "World Chain",
    chainId: 480,
    kind: "evm",
    contractOrMint: "0x79a02482a880bce3f13e09da970dc34db4cd24d1",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    cctpDomain: 14,
    explorerUrl: "https://worldscan.org",
    txUrlPrefix: "https://worldscan.org/tx/",
    addressUrlPrefix: "https://worldscan.org/address/",
    alchemySubdomain: "worldchain-mainnet",
    publicRpc: ["https://worldchain-mainnet.g.alchemy.com/public"],
    scan: true,
  },
  celo: {
    chainSlug: "celo",
    chainName: "Celo",
    chainId: 42220,
    kind: "evm",
    contractOrMint: "0xceba9300f2b948710d2653dd7b07f33a8b32118c",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    // Celo has native USDC but is NOT a CCTP chain. It appears on Circle's
    // USDC contract list and on no CCTP domain list.
    cctpDomain: null,
    explorerUrl: "https://celoscan.io",
    txUrlPrefix: "https://celoscan.io/tx/",
    addressUrlPrefix: "https://celoscan.io/address/",
    alchemySubdomain: "celo-mainnet",
    publicRpc: ["https://celo-rpc.publicnode.com"],
    scan: true,
  },
  zksync: {
    chainSlug: "zksync",
    chainName: "ZKsync Era",
    chainId: 324,
    kind: "evm",
    contractOrMint: "0x1d17cbcf0d6d143135ae902365d2e5e2a16538d4",
    decimals: 6,
    isNative: true,
    circleVerified: true,
    cctpDomain: null,
    explorerUrl: "https://explorer.zksync.io",
    txUrlPrefix: "https://explorer.zksync.io/tx/",
    addressUrlPrefix: "https://explorer.zksync.io/address/",
    alchemySubdomain: "zksync-mainnet",
    publicRpc: ["https://mainnet.era.zksync.io"],
    scan: true,
  },
};

/* ------------------------------------------------------------------ */
/* CCTP domains                                                        */
/* ------------------------------------------------------------------ */

/**
 * Every CCTP domain, whether or not we can read that chain.
 *
 * This is deliberately separate from USDC_ASSETS and deliberately complete. A
 * burn observed on Base can name any domain as its destination, and naming the
 * destination "domain:22" instead of "Plume" is a worse report than naming it
 * correctly — even though we do not scan Plume. Completeness here costs nothing
 * and removes a whole class of "unknown chain" output.
 *
 * `native` records whether that chain has native USDC per Circle's contract
 * list. BNB Smart Chain is the instructive case: it is a CCTP V2 domain but
 * does not appear on the native-USDC list, so it is `native: false`.
 */
export const CCTP_DOMAINS: Record<number, { name: string; version: 1 | 2; native: boolean }> = {
  0: { name: "Ethereum", version: 2, native: true },
  1: { name: "Avalanche", version: 2, native: true },
  2: { name: "OP Mainnet", version: 2, native: true },
  3: { name: "Arbitrum", version: 2, native: true },
  4: { name: "Noble", version: 1, native: true },
  5: { name: "Solana", version: 2, native: true },
  6: { name: "Base", version: 2, native: true },
  7: { name: "Polygon PoS", version: 2, native: true },
  8: { name: "Sui", version: 1, native: true },
  9: { name: "Aptos", version: 2, native: true },
  10: { name: "Unichain", version: 2, native: true },
  11: { name: "Linea", version: 2, native: true },
  12: { name: "Codex", version: 2, native: true },
  13: { name: "Sonic", version: 2, native: true },
  14: { name: "World Chain", version: 2, native: true },
  15: { name: "Monad", version: 2, native: true },
  16: { name: "Sei", version: 2, native: true },
  17: { name: "BNB Smart Chain", version: 2, native: false },
  18: { name: "XDC", version: 2, native: true },
  19: { name: "HyperEVM", version: 2, native: true },
  21: { name: "Ink", version: 2, native: true },
  22: { name: "Plume", version: 2, native: true },
  25: { name: "Starknet", version: 2, native: true },
  26: { name: "Arc", version: 2, native: true },
  27: { name: "Stellar", version: 2, native: true },
  28: { name: "EDGE", version: 2, native: true },
  29: { name: "Injective", version: 2, native: true },
  30: { name: "Morph", version: 2, native: true },
  31: { name: "Pharos", version: 2, native: true },
  32: { name: "Cronos", version: 2, native: true },
  33: { name: "Plasma", version: 2, native: true },
  37: { name: "X Layer", version: 2, native: true },
};

/* ------------------------------------------------------------------ */
/* CCTP V2 contracts                                                   */
/* ------------------------------------------------------------------ */

/**
 * CCTP V2 deploys at the same address on every EVM chain but one.
 *
 * That uniformity is why the scanner can use a single address constant instead
 * of a per-chain table. EDGE (domain 28) is the exception and gets an override.
 */
export const CCTP_V2_TOKEN_MESSENGER = "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d";
export const CCTP_V2_MESSAGE_TRANSMITTER = "0x81d40f21f12a8f0e3252bccb954d722d4c464b64";
export const CCTP_V2_TOKEN_MINTER = "0xfd78ee919681417d192449715b2594ab58f5d002";

/** Domains whose CCTP V2 contracts are not at the canonical addresses. */
export const CCTP_V2_OVERRIDES: Record<number, { tokenMessenger: string; messageTransmitter: string }> = {
  28: {
    tokenMessenger: "0x98706a006bc632df31cadfcbd43f38887ce2ca5c",
    messageTransmitter: "0x5b61381fc9e58e70efc13a4a97516997019198ee",
  },
};

/**
 * CCTP V1 TokenMessenger. Retained for one reason only: V1 is being phased out
 * but legacy burns can still appear in a backfill window, and a V1 burn seen
 * without this constant would be misfiled as an ordinary transfer to an
 * unlabelled address.
 */
export const CCTP_V1_TOKEN_MESSENGER = "0xbd3fa81b58ba92a82136038b25adec70fefe78b5";

/** Solana CCTP V2 program IDs. */
export const CCTP_V2_SOLANA_MESSAGE_TRANSMITTER = "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC";
export const CCTP_V2_SOLANA_TOKEN_MESSENGER = "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe";

/* ------------------------------------------------------------------ */
/* EVENT TOPICS                                                        */
/* ------------------------------------------------------------------ */

// These are keccak256 of the event signatures, but they were NOT computed here
// and they were NOT recalled. Each one was read out of a live log on Base
// (chainId 8453) on 2026-09-29 and its decoding checked field by field against
// the contract source, because a wrong topic0 makes the scanner silently return
// nothing rather than fail. The `scripts/verify-topics` doctor check re-reads
// them from chain so a future change is caught rather than assumed.
//
// Recovering one of these by hand: fetch logs for the contract address with no
// topic filter, group by topics[0], and match the field layout below.

/** ERC-20 `Transfer(address indexed from, address indexed to, uint256 value)`. */
export const TOPIC_ERC20_TRANSFER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * TokenMessengerV2 `DepositForBurn`.
 *
 *   DepositForBurn(
 *     address indexed burnToken,             topics[1]
 *     uint256 amount,                        data word 0
 *     address indexed depositor,             topics[2]
 *     bytes32 mintRecipient,                 data word 1
 *     uint32  destinationDomain,             data word 2
 *     bytes32 destinationTokenMessenger,     data word 3
 *     bytes32 destinationCaller,             data word 4
 *     uint256 maxFee,                        data word 5
 *     uint32 indexed minFinalityThreshold,   topics[3]
 *     bytes   hookData                       data word 6 = offset
 *   )
 *
 * Note what is NOT here: a nonce. In V2 the nonce is assigned by Circle's
 * attestation service, not on the source chain, which is why correlating a burn
 * to its mint needs iris.ts rather than two log reads. V1's DepositForBurn did
 * carry a uint64 nonce; that difference is the whole reason cctp.ts keys on a
 * bytes32 string instead of a number.
 */
export const TOPIC_CCTP_V2_DEPOSIT_FOR_BURN =
  "0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5";

/**
 * TokenMessengerV2 `MintAndWithdraw` — the destination-side mint.
 *
 *   MintAndWithdraw(
 *     address indexed mintRecipient,  topics[1]
 *     uint256 amount,                 data word 0
 *     address indexed mintToken,      topics[2]
 *     uint256 feeCollected            data word 1
 *   )
 */
export const TOPIC_CCTP_V2_MINT_AND_WITHDRAW =
  "0x50c55e915134d457debfa58eb6f4342956f8b0616d51a89a3659360178e1ab63";

/**
 * MessageTransmitterV2 `MessageReceived` — carries the authoritative nonce.
 *
 *   MessageReceived(
 *     address indexed caller,                    topics[1]
 *     uint32  sourceDomain,                      data word 0
 *     bytes32 indexed nonce,                     topics[2]   <- correlation key
 *     bytes32 sender,                            data word 1
 *     uint32 indexed finalityThresholdExecuted,  topics[3]
 *     bytes   messageBody                        data word 2 = offset
 *   )
 */
export const TOPIC_CCTP_V2_MESSAGE_RECEIVED =
  "0xff48c13eda96b1cceacc6b9edeedc9e9db9d6226afbc30146b720c19d3addb1c";

/** MessageTransmitterV2 `MessageSent(bytes message)` — no indexed fields. */
export const TOPIC_CCTP_V2_MESSAGE_SENT =
  "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036";

/**
 * Byte offsets in a CCTP V2 message, per Circle's message-format spec and
 * confirmed against a live MessageSent payload.
 *
 * On the source chain the nonce field is all zeros — the attestation service
 * fills it in. Reading it from MessageSent and treating it as a correlation key
 * would produce a table full of rows keyed on zero.
 */
export const CCTP_V2_MSG = {
  version: 0,
  sourceDomain: 4,
  destinationDomain: 8,
  nonce: 12,
  sender: 44,
  recipient: 76,
  destinationCaller: 108,
  minFinalityThreshold: 140,
  finalityThresholdExecuted: 144,
  body: 148,
} as const;

/** `finalityThresholdExecuted` values CCTP uses. 1000 = Fast, 2000 = Standard. */
export const CCTP_FINALITY = { fast: 1000, standard: 2000 } as const;

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

/**
 * Aliases where our chain slug and Circle's domain name legitimately differ.
 *
 * Kept explicit so the consistency check below can be strict. Anything not listed
 * here MUST match, which is what stops a domain silently naming a different chain.
 */
const DOMAIN_NAME_ALIASES: Record<string, string> = {
  arbitrum: "Arbitrum",
  avalanche: "Avalanche",
  worldchain: "World Chain",
  zksync: "ZKsync Era",
};

/**
 * Verify the registry against the domain table, and fail loudly if they disagree.
 *
 * WHY THIS IS AN ASSERTION AND NOT A COMMENT. The previous registry had Celo at
 * domain 8 and Linea at 9 — domain 8 is Sui and 9 is Aptos. Nothing caught it,
 * because a wrong domain does not throw: it produces a real cross-chain alert
 * naming the wrong destination chain, which reads as entirely plausible. The only
 * defence against that class of error is a check that refuses to start.
 *
 * Returns the problems rather than throwing, so `doctor` can print all of them at
 * once; `assertRegistryConsistent` is the throwing wrapper used at startup.
 */
export function registryProblems(): string[] {
  const problems: string[] = [];
  const claimed = new Map<number, string>();

  for (const [slug, a] of Object.entries(USDC_ASSETS)) {
    if (a.chainSlug !== slug) {
      problems.push(`key "${slug}" disagrees with chainSlug "${a.chainSlug}"`);
    }
    if (a.decimals !== 6) {
      problems.push(`${slug} claims ${a.decimals} decimals; every Circle USDC deployment is 6`);
    }
    if (a.kind === "evm" && !/^0x[0-9a-f]{40}$/.test(a.contractOrMint)) {
      problems.push(`${slug} contract is not a lowercase 20-byte address: ${a.contractOrMint}`);
    }
    if (a.kind === "evm" && a.chainId === null) {
      problems.push(`${slug} is EVM but has no chain ID`);
    }
    if (a.scan && a.kind === "evm" && a.publicRpc.length === 0 && a.alchemySubdomain === null) {
      problems.push(`${slug} is marked scannable but has no endpoint — it would report empty scans forever`);
    }
    if (!a.txUrlPrefix.startsWith("https://") || !a.txUrlPrefix.endsWith("/")) {
      problems.push(`${slug} tx URL prefix would build a broken link: ${a.txUrlPrefix}`);
    }

    if (a.cctpDomain === null) continue;

    const dup = claimed.get(a.cctpDomain);
    if (dup) {
      problems.push(`CCTP domain ${a.cctpDomain} is claimed by both ${dup} and ${slug}`);
    }
    claimed.set(a.cctpDomain, slug);

    const d = CCTP_DOMAINS[a.cctpDomain];
    if (!d) {
      problems.push(`${slug} claims CCTP domain ${a.cctpDomain}, which is not in the domain table`);
      continue;
    }

    // THE CHECK THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. Celo at domain 8 would
    // have compared "Celo" against "Sui" and failed here.
    const expected = DOMAIN_NAME_ALIASES[slug] ?? a.chainName;
    if (d.name !== expected) {
      problems.push(
        `${slug} claims CCTP domain ${a.cctpDomain}, but that domain is "${d.name}" ` +
          `and this chain is "${a.chainName}" — a burn would be attributed to the wrong chain`
      );
    }
    if (!d.native) {
      problems.push(
        `${slug} is in the native-USDC registry but domain ${a.cctpDomain} is marked non-native`
      );
    }
  }

  return problems;
}

/** Throwing wrapper. Called before anything reads the registry for real. */
export function assertRegistryConsistent(): void {
  const problems = registryProblems();
  if (problems.length) {
    throw new Error(
      `USDC registry is inconsistent and would misattribute transfers:\n  - ` +
        problems.join("\n  - ")
    );
  }
}

/**
 * Is this contract/mint the verified native USDC for this chain?
 *
 * The one gate every ingestion path goes through. Deliberately strict: an
 * unknown chain returns false rather than falling back to a symbol check.
 */
export function isNativeUsdc(chainSlug: string, address: string): boolean {
  const asset = USDC_ASSETS[chainSlug.toLowerCase()];
  if (!asset) return false;
  // Solana mints are case-sensitive base58; EVM addresses are not. Comparing
  // case-insensitively on Solana would accept a different valid mint whose
  // base58 differs only in case, so the two are compared differently.
  if (asset.kind === "solana") return asset.contractOrMint === address.trim();
  return asset.contractOrMint === address.trim().toLowerCase();
}

export function getUsdcAsset(chainSlug: string): UsdcAsset | null {
  return USDC_ASSETS[chainSlug.toLowerCase()] ?? null;
}

export function getAllUsdcAssets(): UsdcAsset[] {
  return Object.values(USDC_ASSETS);
}

/** Assets the scanners actually read, which is what `doctor` should report. */
export function getScannedAssets(): UsdcAsset[] {
  return Object.values(USDC_ASSETS).filter((a) => a.scan);
}

export function getEvmScanAssets(): UsdcAsset[] {
  return Object.values(USDC_ASSETS).filter((a) => a.scan && a.kind === "evm");
}

/** Our chain slug for a CCTP domain, or null when we do not track that chain. */
export function getChainByCctpDomain(domain: number): string | null {
  for (const asset of Object.values(USDC_ASSETS)) {
    if (asset.cctpDomain === domain) return asset.chainSlug;
  }
  return null;
}

/**
 * A human name for a CCTP domain, falling back to the domain number.
 *
 * Used for the destination of a burn heading somewhere we do not scan. The
 * `domain:NN` fallback is intentionally ugly: it should read as "we do not know
 * this chain", not as a name.
 */
export function cctpDomainName(domain: number): string {
  return CCTP_DOMAINS[domain]?.name ?? `domain:${domain}`;
}

export function getCctpDomain(chainSlug: string): number | null {
  return USDC_ASSETS[chainSlug.toLowerCase()]?.cctpDomain ?? null;
}

/** CCTP V2 contract addresses for a chain, honouring per-domain overrides. */
export function cctpContractsFor(chainSlug: string): {
  tokenMessenger: string;
  messageTransmitter: string;
} | null {
  const domain = getCctpDomain(chainSlug);
  if (domain === null) return null;
  const override = CCTP_V2_OVERRIDES[domain];
  if (override) return override;
  return {
    tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
    messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
  };
}

/**
 * Is this address a CCTP contract on any chain?
 *
 * Used by the classifier to recognise the burn/mint legs of a cross-chain
 * transfer, which must not be counted as ordinary movement.
 */
export function isCctpContract(address: string): boolean {
  const a = address.trim().toLowerCase();
  if (
    a === CCTP_V2_TOKEN_MESSENGER ||
    a === CCTP_V2_MESSAGE_TRANSMITTER ||
    a === CCTP_V2_TOKEN_MINTER ||
    a === CCTP_V1_TOKEN_MESSENGER
  ) {
    return true;
  }
  for (const o of Object.values(CCTP_V2_OVERRIDES)) {
    if (a === o.tokenMessenger || a === o.messageTransmitter) return true;
  }
  const raw = address.trim();
  return raw === CCTP_V2_SOLANA_MESSAGE_TRANSMITTER || raw === CCTP_V2_SOLANA_TOKEN_MESSENGER;
}

/** Retained under the previous name so existing callers keep compiling. */
export const isCctpMessenger = isCctpContract;

export const CCTP_TOKEN_MESSENGER_EVM = CCTP_V2_TOKEN_MESSENGER;
export const CCTP_TOKEN_MESSENGER_LEGACY = CCTP_V1_TOKEN_MESSENGER;
