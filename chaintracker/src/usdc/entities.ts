// Entity resolution for USDC Movement Tracker.
//
// Identifies CEXs, Circle Mint/Burn, Bridges, DEXs, and FurlPay tracked wallets.
// Unknown wallets remain "Unknown Wallet" with 0.5 confidence rather than being guessed.

import type { AddressCategory } from "../types/index.js";
import type { TrackedWallet } from "./types.js";
import { env } from "../config/env.js";
import { getUsdcAsset, isCctpContract } from "./registry.js";
import { makeLogger } from "../util/logger.js";

export interface ResolvedEntity {
  entity: string | null;
  category: AddressCategory;
  label: string;
  confidence: number;
  isFurlPay: boolean;
  isExchange: boolean;
  isBurnOrMint: boolean;
}

/** Seeded exchange & institutional addresses confirmed on-chain */
const KNOWN_ENTITIES: Array<{
  chainSlug: string;
  address: string;
  label: string;
  entity: string;
  category: AddressCategory;
}> = [
  // --- Ethereum ----------------------------------------------------
  // Coinbase
  { chainSlug: "ethereum", address: "0x71660c4005ba85c37ccec55d0c4493e66fe775d3", label: "Coinbase 10", entity: "Coinbase", category: "cex" },
  { chainSlug: "ethereum", address: "0x503828976d22510aad0201ac7ec88293211d23dc", label: "Coinbase 2", entity: "Coinbase", category: "cex" },
  { chainSlug: "ethereum", address: "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43", label: "Coinbase Prime", entity: "Coinbase", category: "cex" },
  { chainSlug: "ethereum", address: "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503", label: "Binance 8", entity: "Binance", category: "cex" },
  { chainSlug: "ethereum", address: "0x28c6c06298d514db089934071355e5743bf21d60", label: "Binance 14", entity: "Binance", category: "cex" },
  { chainSlug: "ethereum", address: "0x21a31ee1afc51d94c2efccaa2092ad1028285549", label: "Binance 15", entity: "Binance", category: "cex" },
  { chainSlug: "ethereum", address: "0xdfd5293d8e347dfe59e90efd55b2956a1343963d", label: "Binance 16", entity: "Binance", category: "cex" },
  { chainSlug: "ethereum", address: "0x2910543af39aba0cd09dbb2d50200b3e800a63d2", label: "Kraken 1", entity: "Kraken", category: "cex" },
  { chainSlug: "ethereum", address: "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13", label: "Kraken 4", entity: "Kraken", category: "cex" },
  { chainSlug: "ethereum", address: "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b", label: "OKX 1", entity: "OKX", category: "cex" },
  { chainSlug: "ethereum", address: "0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf", label: "Polygon Bridge", entity: "Polygon", category: "bridge" },
  { chainSlug: "ethereum", address: "0x4015627f45a1db2442dbe0797bc655c5b52b3149", label: "Polygon PoS Bridge", entity: "Polygon", category: "bridge" },
  { chainSlug: "ethereum", address: "0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f", label: "Arbitrum One Gateway", entity: "Arbitrum", category: "bridge" },
  { chainSlug: "ethereum", address: "0x99c9fc46f92e8a1c0dec1b1747d010903e559bcc", label: "Optimism Portal", entity: "Optimism", category: "bridge" },
  { chainSlug: "ethereum", address: "0x3154cf16ccdb4c6d922629664174b904d80f2c35", label: "Base Portal", entity: "Base", category: "bridge" },
  { chainSlug: "ethereum", address: "0x55452243d6b052efc15acdae8ab9fa51892d19f8", label: "Circle: Mint / Treasury", entity: "Circle", category: "treasury" },

  // --- Base ---------------------------------------------------------
  { chainSlug: "base", address: "0x3304e22ddaa22bcdc429949a86ca55c42621f540", label: "Coinbase Base Deposit", entity: "Coinbase", category: "cex" },
  { chainSlug: "base", address: "0x2213768b5a0349b1ff40a44fa6600c6d26733221", label: "Coinbase Base 2", entity: "Coinbase", category: "cex" },
  { chainSlug: "base", address: "0x20fe562d797a42dcb3399062ae9546cd06f63280", label: "Binance Base Hot", entity: "Binance", category: "cex" },
  { chainSlug: "base", address: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24", label: "Uniswap V3 Base", entity: "Uniswap", category: "dex" },
  { chainSlug: "base", address: "0x0000000000000000000000000000000000000000", label: "Burn Address", entity: "System", category: "burn" },

  // --- Arbitrum -----------------------------------------------------
  { chainSlug: "arbitrum", address: "0xb38e8c17e38363a405429e6543b597405e3b567c", label: "Binance Arbitrum Hot", entity: "Binance", category: "cex" },
  { chainSlug: "arbitrum", address: "0x261a8685e135cb175ff474b882eb7297e682283e", label: "Coinbase Arbitrum", entity: "Coinbase", category: "cex" },
  { chainSlug: "arbitrum", address: "0x0b8a4f91ef1409748b6bc17e80bf4a0ec0949d05", label: "OKX Arbitrum", entity: "OKX", category: "cex" },
  { chainSlug: "arbitrum", address: "0xe592427a0aece92de3edee1f18e0157c05861564", label: "Uniswap V3 Router", entity: "Uniswap", category: "dex" },

  // --- Optimism -----------------------------------------------------
  { chainSlug: "optimism", address: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", label: "Binance OP Hot", entity: "Binance", category: "cex" },
  { chainSlug: "optimism", address: "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", label: "Uniswap Swap Router", entity: "Uniswap", category: "dex" },

  // --- Polygon ------------------------------------------------------
  { chainSlug: "polygon", address: "0x5a52e96bacdabb82fd05763e25335261b170fbfc", label: "Binance Polygon Hot", entity: "Binance", category: "cex" },
  { chainSlug: "polygon", address: "0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245", label: "Coinbase Polygon", entity: "Coinbase", category: "cex" },

  // --- Avalanche ----------------------------------------------------
  { chainSlug: "avalanche", address: "0x89e02c5102553b34208a0d2dc0fefd0fd0cbf7ba", label: "Binance Avalanche Hot", entity: "Binance", category: "cex" },

  // --- Solana -------------------------------------------------------
  { chainSlug: "solana", address: "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S", label: "Binance 2 Hot", entity: "Binance", category: "cex" },
  { chainSlug: "solana", address: "5tzFkiKscBiz8ugDTAD5nhGMWNctV2DyujQNVGWtcHgJ", label: "Binance Hot", entity: "Binance", category: "cex" },
  { chainSlug: "solana", address: "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS", label: "Coinbase Cold", entity: "Coinbase", category: "cex" },
  { chainSlug: "solana", address: "GJRs4FwHtemZ5ZE9x3FNvJ83qwYnnxPrLkVQDogMnPdH", label: "Coinbase Hot", entity: "Coinbase", category: "cex" },
  { chainSlug: "solana", address: "FWznbcNXWQuHTawe9RxvQ2LdJF2YScfsKtUQsDTq3jDa", label: "Kraken Hot", entity: "Kraken", category: "cex" },
  { chainSlug: "solana", address: "11111111111111111111111111111111", label: "System Program", entity: "System", category: "burn" },
];

const log = makeLogger("usdc:entities");

/** Fast in-memory map keyed by `${chainSlug}:${normalizedAddress}` */
const entityMap = new Map<string, (typeof KNOWN_ENTITIES)[0]>();
for (const e of KNOWN_ENTITIES) {
  entityMap.set(`${e.chainSlug.toLowerCase()}:${e.address.toLowerCase()}`, e);
}

/** In-memory cache of FurlPay tracked wallets */
let furlPayWallets: TrackedWallet[] = [];
let furlPayLoaded = false;

/**
 * Problems found while parsing FURLPAY_TRACKED_WALLETS.
 *
 * Collected rather than thrown, so one bad entry does not discard the good ones —
 * but surfaced by `doctor`, because the whole failure mode here is an address that
 * is configured, accepted, and silently matches nothing.
 */
export interface WalletConfigProblem {
  entry: string;
  problem: string;
}

let furlPayProblems: WalletConfigProblem[] = [];

/** Problems from the last parse. Empty until loadFurlPayTrackedWallets() runs. */
export function furlPayConfigProblems(): WalletConfigProblem[] {
  loadFurlPayTrackedWallets();
  return furlPayProblems;
}

/**
 * Normalise an address the way its chain family stores it.
 *
 * THE BUG THIS FIXES. This parser used to call `.toLowerCase()` on every address.
 * For EVM that is right — ingestion lowercases too, so they match. For Solana it is
 * silently fatal: base58 is case-sensitive and stored with its original case, so a
 * lowercased Solana wallet matches nothing, forever, with no error anywhere. A
 * configured FurlPay Solana wallet simply never alerted.
 */
function normaliseAddressFor(chainSlug: string, address: string): string | null {
  const asset = getUsdcAsset(chainSlug);
  if (!asset) return null;
  const raw = address.trim();
  if (asset.kind === "solana") {
    // base58: no 0, O, I or l. Length 32-44 for a pubkey.
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw) ? raw : null;
  }
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw.toLowerCase() : null;
}

const WALLET_TYPES: ReadonlySet<string> = new Set([
  "furlpay_treasury",
  "furlpay_settlement",
  "furlpay_operations",
  "furlpay_customer_deposit",
  "furlpay_hot_wallet",
  "exchange",
  "whale",
  "custom",
]);

/**
 * Validate one configured wallet, or explain why it was refused.
 *
 * STRICT ON PURPOSE. Every rejection here is a case that used to be accepted and
 * then matched nothing: an unknown chain slug, a mistyped address, a Solana address
 * folded to lower case. Accepting those made the configuration look applied when it
 * was inert, and the operator's only clue would have been alerts that never arrived.
 */
function validateWallet(
  chain: unknown,
  address: unknown,
  label: unknown,
  walletType: unknown,
  entry: string
): TrackedWallet | WalletConfigProblem {
  const chainSlug = String(chain ?? "").toLowerCase().trim();
  if (!chainSlug) return { entry, problem: "no chain" };
  if (!getUsdcAsset(chainSlug)) {
    return { entry, problem: `unknown chain "${chainSlug}" — not in the USDC registry` };
  }

  const raw = String(address ?? "").trim();
  if (!raw) return { entry, problem: "no address" };
  const norm = normaliseAddressFor(chainSlug, raw);
  if (norm === null) {
    return {
      entry,
      problem: `"${raw}" is not a valid address for ${chainSlug}`,
    };
  }

  // AN ALL-LOWERCASE SOLANA ADDRESS IS ALMOST CERTAINLY CASE-FOLDED.
  //
  // This cannot be caught by format: lower-casing a base58 account yields another
  // syntactically valid account, just a different one. So the only signal is the
  // statistical one — a real 32-byte pubkey encodes to ~44 base58 characters, and the
  // chance that none of them is upper case is vanishingly small. The consequence of
  // missing it is severe and silent (the wallet tracks nothing, forever), and a false
  // positive costs one clear error message, so flagging is the right trade.
  if (getUsdcAsset(chainSlug)?.kind === "solana" && norm === norm.toLowerCase()) {
    return {
      entry,
      problem:
        `"${norm}" has no upper-case characters, which a real Solana address ` +
        `essentially always has — it looks case-folded, and would match nothing`,
    };
  }

  if (/^0x0{40}$/.test(norm) || norm === "11111111111111111111111111111111") {
    return { entry, problem: "the zero / system address is not a wallet" };
  }

  // A CONFIGURED ADDRESS MUST NOT SHADOW A KNOWN THIRD PARTY.
  //
  // FurlPay wallets bypass the alert threshold entirely, so mislabelling a busy
  // exchange or router as FurlPay would post an alert for every transfer it touches.
  // That is precisely what the deleted seed data did — it shipped the 1inch v4
  // router as "FurlPay Main Treasury". Refusing the collision makes the same mistake
  // impossible to make by configuration.
  const known = entityMap.get(`${chainSlug}:${norm.toLowerCase()}`);
  if (known) {
    return {
      entry,
      problem:
        `${norm} on ${chainSlug} is a known ${known.entity} address (${known.label}) — ` +
        `refusing to relabel it as FurlPay`,
    };
  }
  if (isCctpContract(norm)) {
    return { entry, problem: `${norm} is a Circle CCTP contract, not a wallet` };
  }
  const type = String(walletType ?? "furlpay_treasury");
  if (!WALLET_TYPES.has(type)) {
    return { entry, problem: `unknown wallet_type "${type}"` };
  }

  return {
    chainSlug,
    address: norm,
    label: String(label ?? "FurlPay Wallet").slice(0, 80),
    walletType: type as TrackedWallet["walletType"],
    entity: "FurlPay",
    source: "env",
  };
}

function isProblem(v: TrackedWallet | WalletConfigProblem): v is WalletConfigProblem {
  return (v as WalletConfigProblem).problem !== undefined;
}

/**
 * Test-injected configuration, used instead of the env snapshot when set.
 *
 * WHY A SEAM IS NEEDED. `config/env.ts` reads process.env once at module load, so
 * setting FURLPAY_TRACKED_WALLETS afterwards has no effect — a test that varies the
 * configuration cannot do so through the environment. Reading process.env live here
 * instead would work but would put this one value outside the central env table,
 * where every other setting is declared and documented.
 *
 * So the override is explicit and only `resetFurlPayWalletCache` can set it.
 * Production never passes it and reads `env.furlpayTrackedWallets` exactly as before.
 */
let rawOverride: string | null | undefined;

export function loadFurlPayTrackedWallets(): TrackedWallet[] {
  if (furlPayLoaded) return furlPayWallets;

  const raw = rawOverride !== undefined ? rawOverride : env.furlpayTrackedWallets;
  const list: TrackedWallet[] = [];
  const problems: WalletConfigProblem[] = [];

  if (raw && raw.trim()) {
    const trimmed = raw.trim();
    // Shape is decided by the first character rather than by try/catch. The old code
    // used a failed JSON.parse as the signal to try the comma form, which meant a
    // JSON value that parsed but was not an array — `{}`, or a single object —
    // yielded zero wallets and never reached the fallback.
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        problems.push({
          entry: trimmed.slice(0, 60),
          problem: `looks like JSON but does not parse: ${(e as Error).message.slice(0, 60)}`,
        });
        parsed = null;
      }
      const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      for (const item of items) {
        const o = (item ?? {}) as Record<string, unknown>;
        const r = validateWallet(
          o.chain,
          o.address,
          o.label,
          o.wallet_type ?? o.walletType,
          JSON.stringify(o).slice(0, 60)
        );
        if (isProblem(r)) problems.push(r);
        else list.push(r);
      }
    } else {
      for (const entry of trimmed.split(",")) {
        const e = entry.trim();
        if (!e) continue;
        const parts = e.split(":");
        if (parts.length < 2) {
          problems.push({ entry: e, problem: "expected chain:address[:label[:type]]" });
          continue;
        }
        const r = validateWallet(parts[0], parts[1], parts[2], parts[3], e);
        if (isProblem(r)) problems.push(r);
        else list.push(r);
      }
    }
  }

  // Duplicate addresses would resolve unpredictably depending on iteration order.
  const seen = new Set<string>();
  const deduped: TrackedWallet[] = [];
  for (const w of list) {
    const key = `${w.chainSlug}:${w.address}`;
    if (seen.has(key)) {
      problems.push({ entry: key, problem: "listed more than once — keeping the first" });
      continue;
    }
    seen.add(key);
    deduped.push(w);
  }

  // NO SEED WALLETS, DELIBERATELY.
  //
  // This function previously invented three addresses and labelled them FurlPay
  // treasuries "for demonstration and testing". One of them,
  // 0x1111111254fb6c44bac0bed2854e76f90643097d, is the 1inch v4 aggregation router —
  // a real, extremely busy Ethereum contract owned by somebody else. Because a
  // FurlPay wallet bypasses the alert threshold completely, every USDC swap routed
  // through 1inch posted a "FurlPay wallet movement" alert attributing a stranger's
  // transaction to a treasury that does not exist.
  //
  // An empty list is the correct answer to "no wallets configured". FURLPAY_TRACKED_
  // WALLETS is the only way a wallet gets in here, and validateWallet now refuses an
  // address that is already known to belong to somebody else.

  if (problems.length) {
    log.warn("FURLPAY_TRACKED_WALLETS has entries that were refused", {
      accepted: deduped.length,
      refused: problems.length,
      first: problems[0]?.problem,
    });
  }

  furlPayWallets = deduped;
  furlPayProblems = problems;
  furlPayLoaded = true;
  return furlPayWallets;
}

/**
 * Forget the parsed configuration so the next call re-parses.
 *
 * `raw` overrides the environment for the next parse — the test seam described on
 * `rawOverride`. Passing `undefined` (or nothing) restores reading from env.
 */
export function resetFurlPayWalletCache(raw?: string | null): void {
  furlPayLoaded = false;
  furlPayWallets = [];
  furlPayProblems = [];
  rawOverride = raw;
}

/**
 * Every labelled address we hold for a chain, in seed order.
 *
 * Exists so the Solana adapter does not need its own address list. Solana
 * coverage is necessarily per-address (no free firehose), and the addresses worth
 * watching are exactly the ones we can already label — a second table would be a
 * second thing to keep correct, and the first symptom of it drifting would be a
 * scanner quietly polling addresses nothing can name.
 */
export function knownAddressesForChain(chainSlug: string): string[] {
  const chain = chainSlug.toLowerCase().trim();
  return KNOWN_ENTITIES.filter((e) => e.chainSlug.toLowerCase() === chain).map((e) => e.address);
}

/** Check if address belongs to FurlPay */
export function getFurlPayWallet(chainSlug: string, address: string): TrackedWallet | null {
  const wallets = loadFurlPayTrackedWallets();
  const normChain = chainSlug.toLowerCase().trim();
  // Normalised per chain family, NOT lowercased unconditionally — folding a Solana
  // base58 account to lower case makes it match nothing, which is how a configured
  // Solana wallet silently never alerted.
  const wanted = normaliseAddressFor(normChain, address);
  if (wanted === null) return null;
  return wallets.find((w) => w.chainSlug === normChain && w.address === wanted) ?? null;
}

/**
 * Resolve an address to its known entity or "Unknown Wallet".
 */
export function resolveEntity(chainSlug: string, address: string): ResolvedEntity {
  const normChain = chainSlug.toLowerCase().trim();
  const raw = address.trim();
  // `normAddr` is the LOOKUP KEY for the seeded entity map, which is built lowercased
  // and holds mostly EVM addresses. It is NOT safe to use for the FurlPay lookup:
  // folding a Solana base58 account to lower case produces a different, valid-looking
  // account that matches nothing. Fixing only getFurlPayWallet left this call site
  // still passing it a lowercased address, so Solana FurlPay wallets still never
  // resolved during ingestion.
  const normAddr = raw.toLowerCase();

  // 1. Is it a FurlPay wallet? Pass the address as written.
  const furlpay = getFurlPayWallet(normChain, raw);
  if (furlpay) {
    return {
      entity: "FurlPay",
      category: "treasury",
      label: furlpay.label,
      confidence: 1.0,
      isFurlPay: true,
      isExchange: false,
      isBurnOrMint: false,
    };
  }

  // 2. Is it a Zero / Burn address?
  if (
    normAddr === "0x0000000000000000000000000000000000000000" ||
    raw === "11111111111111111111111111111111"
  ) {
    return {
      entity: "Circle / Protocol",
      category: "burn",
      label: "Burn / Mint Address",
      confidence: 1.0,
      isFurlPay: false,
      isExchange: false,
      isBurnOrMint: true,
    };
  }

  // 3. Circle's own CCTP contracts.
  //
  // Without this, the burn and mint legs of every cross-chain transfer show as
  // "Unknown Wallet" moving enormous sums — which reads as whale activity and is
  // exactly the misattribution the CCTP correlator exists to prevent. The
  // addresses come from registry.ts, so there is one list of them.
  if (isCctpContract(raw)) {
    return {
      entity: "Circle",
      category: "bridge",
      label: "Circle CCTP",
      confidence: 1.0,
      isFurlPay: false,
      isExchange: false,
      isBurnOrMint: false,
    };
  }

  // 4. Known exchanges & institutions
  const hit = entityMap.get(`${normChain}:${normAddr}`);
  if (hit) {
    return {
      entity: hit.entity,
      category: hit.category,
      label: hit.label,
      confidence: 0.95,
      isFurlPay: false,
      isExchange: hit.category === "cex",
      isBurnOrMint: hit.category === "burn",
    };
  }

  // 5. Default: Unknown Wallet
  return {
    entity: null,
    category: "unknown",
    label: "Unknown Wallet",
    confidence: 0.5,
    isFurlPay: false,
    isExchange: false,
    isBurnOrMint: false,
  };
}
