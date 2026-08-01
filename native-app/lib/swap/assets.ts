import { bySeverity, type MoneyWarning } from "@/lib/warnings";

export { WARNING_COLOR } from "@/lib/warnings";
export type { WarningLevel } from "@/lib/warnings";

// ---------------------------------------------------------------------------
// Asset and chain catalogue — the single source of truth for what the app can
// move, on which chains, and what the UI is allowed to offer.
//
// Named for swap because swap is where it started; the send screen reads the
// same CHAINS table and the same drawn icons, because "USDC on Arbitrum" must
// look and read identically wherever it appears.
//
// WHY ROUTABILITY IS A PROPERTY OF THE ASSET, NOT THE SCREEN. The backend
// quotes through LI.FI, which is EVM-only (apps/web/src/lib/services/
// swapQuote.ts). Jupiter is planned, not built, so no Solana pair can be priced
// today. A selector that offers SOL and then fails at quote time teaches users
// the app is broken; one that shows SOL as "routing coming soon" teaches them
// it is coming. The difference is one boolean, and it belongs HERE so no screen
// can accidentally offer an unroutable pair.
//
// ICONS ARE DRAWN, NOT FETCHED. A remote logo is a network dependency on the
// most latency-sensitive screen in the app, and a broken image on a money
// screen reads as a broken app. Each asset carries a brand colour and a short
// glyph; TokenIcon renders that deterministically, offline, at any size.
// ---------------------------------------------------------------------------

export type ChainId =
  | "ethereum"
  | "polygon"
  | "base"
  | "arbitrum"
  | "solana"
  | "gnosis"
  | "robinhood"
  | "bsc";

export type AssetClass = "stablecoin" | "native" | "equity" | "etf" | "treasury";

export interface ChainMeta {
  id: ChainId;
  name: string;
  short: string;
  color: string;
  /** False until a quote provider can price routes on this chain. */
  routable: boolean;
  /**
   * Block-explorer transaction URL prefix.
   *
   * Used ONLY when an execution actually returns a transaction hash. The
   * current /api/swaps execution path returns none, so no link renders today —
   * see ProgressTimeline. A receipt that links to nothing is worse than no
   * link, so the two are kept strictly coupled.
   */
  explorerTx?: string;
  /** Shown wherever the chain is offered but unroutable. */
  unroutableReason?: string;
}

/** Mirrors CHAINS in the swap screen and SwapSchema on the server. */
export const CHAINS: Record<ChainId, ChainMeta> = {
  arbitrum: { id: "arbitrum", name: "Arbitrum One", short: "ARB", color: "#28A0F0", routable: true, explorerTx: "https://arbiscan.io/tx/" },
  base: { id: "base", name: "Base", short: "BASE", color: "#0052FF", routable: true, explorerTx: "https://basescan.org/tx/" },
  ethereum: { id: "ethereum", name: "Ethereum", short: "ETH", color: "#627EEA", routable: true, explorerTx: "https://etherscan.io/tx/" },
  polygon: { id: "polygon", name: "Polygon", short: "POL", color: "#8247E5", routable: true, explorerTx: "https://polygonscan.com/tx/" },
  gnosis: { id: "gnosis", name: "Gnosis", short: "GNO", color: "#04795B", routable: true, explorerTx: "https://gnosisscan.io/tx/" },
  bsc: { id: "bsc", name: "BNB Chain", short: "BNB", color: "#F0B90B", routable: true, explorerTx: "https://bscscan.com/tx/" },
  robinhood: { id: "robinhood", name: "Robinhood Chain", short: "RH", color: "#CCFF00", routable: true },
  // Jupiter is the missing quote provider. Until it ships the server cannot
  // price a single Solana route, so the UI must not request one.
  solana: {
    id: "solana",
    name: "Solana",
    short: "SOL",
    color: "#14F195",
    routable: false,
    unroutableReason: "Solana routing coming soon",
    explorerTx: "https://solscan.io/tx/",
  },
};

export interface SwapAsset {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  /** Chains this asset exists on, in preference order. */
  chains: ChainId[];
  color: string;
  /** 1–2 characters. Kept short so the glyph stays legible at 24px. */
  glyph: string;
  decimals: number;
  /**
   * Fiat currency this asset is pegged to, for stablecoins only.
   *
   * This is the ONLY reference price the app has offline, and it is what makes
   * price impact computable without an oracle: two assets on the same peg
   * should trade near 1:1, so any shortfall beyond the declared fees is route
   * cost. Assets with no peg (or two different pegs) get no impact figure at
   * all rather than a fabricated one — see usePriceImpact.
   */
  peg?: "USD" | "EUR" | "SGD";
  /** Equities and RWAs carry an issuer and settlement caveats. */
  issuer?: string;
  underlying?: string;
  /** Free-text restriction shown before the user can select it. */
  restriction?: string;
}

/** Stablecoins and native assets — mirrors TOKENS in the swap screen. */
export const ASSETS: SwapAsset[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    assetClass: "stablecoin",
    chains: ["arbitrum", "base", "ethereum", "polygon", "solana"],
    color: "#2775CA",
    glyph: "$",
    decimals: 6,
    peg: "USD",
    issuer: "Circle",
  },
  {
    symbol: "USDT",
    name: "Tether",
    assetClass: "stablecoin",
    chains: ["ethereum", "polygon", "arbitrum", "bsc"],
    color: "#26A17B",
    glyph: "₮",
    decimals: 6,
    peg: "USD",
    issuer: "Tether",
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    assetClass: "stablecoin",
    chains: ["ethereum", "base", "solana"],
    color: "#1E5FCC",
    glyph: "€",
    decimals: 6,
    peg: "EUR",
    issuer: "Circle",
  },
  {
    symbol: "PYUSD",
    name: "PayPal USD",
    assetClass: "stablecoin",
    chains: ["ethereum", "solana"],
    color: "#0070BA",
    glyph: "P",
    decimals: 6,
    peg: "USD",
    issuer: "Paxos",
  },
  {
    symbol: "DAI",
    name: "Dai",
    assetClass: "stablecoin",
    chains: ["ethereum", "polygon", "arbitrum", "gnosis"],
    color: "#F5AC37",
    glyph: "◈",
    decimals: 18,
    peg: "USD",
    issuer: "Sky",
  },
  {
    symbol: "XSGD",
    name: "StraitsX SGD",
    assetClass: "stablecoin",
    chains: ["ethereum", "polygon", "arbitrum"],
    color: "#E4002B",
    glyph: "S$",
    decimals: 6,
    peg: "SGD",
    issuer: "StraitsX",
  },
  {
    symbol: "XUSD",
    name: "StraitsX USD",
    assetClass: "stablecoin",
    chains: ["ethereum", "arbitrum"],
    color: "#B00020",
    glyph: "X$",
    decimals: 6,
    peg: "USD",
    issuer: "StraitsX",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    assetClass: "native",
    chains: ["ethereum", "arbitrum", "base", "polygon"],
    color: "#627EEA",
    glyph: "Ξ",
    decimals: 18,
  },
  {
    symbol: "SOL",
    name: "Solana",
    assetClass: "native",
    chains: ["solana"],
    color: "#14F195",
    glyph: "◎",
    decimals: 9,
  },
];

const BY_SYMBOL = new Map(ASSETS.map((a) => [a.symbol, a]));

export function assetBySymbol(symbol: string): SwapAsset | undefined {
  return BY_SYMBOL.get(symbol);
}

export interface Routability {
  routable: boolean;
  /** Present when not routable. Written for a user, not a log. */
  reason?: string;
}

/**
 * Can this exact pair be quoted right now?
 *
 * Checked in the UI so an unroutable pair is never sent to the server. The
 * server remains the authority — it will refuse anyway — but a user should
 * learn a route is unavailable from a disabled row, not from a failed request
 * after they have already typed an amount.
 */
export function routability(
  fromChain: ChainId,
  toChain: ChainId,
  fromSymbol?: string,
  toSymbol?: string
): Routability {
  for (const id of [fromChain, toChain]) {
    const chain = CHAINS[id];
    if (!chain.routable) {
      return { routable: false, reason: chain.unroutableReason ?? `${chain.name} is not supported yet` };
    }
  }
  if (fromSymbol && toSymbol && fromSymbol === toSymbol && fromChain === toChain) {
    return { routable: false, reason: "Pick two different assets" };
  }
  return { routable: true };
}

/** Chains an asset can actually be swapped on today. */
export function routableChainsFor(asset: SwapAsset): ChainMeta[] {
  return asset.chains.map((c) => CHAINS[c]).filter((c) => c.routable);
}

/** True when the asset exists ONLY on chains we cannot route yet. */
export function isAssetUnroutable(asset: SwapAsset): boolean {
  return routableChainsFor(asset).length === 0;
}

// ── Risk surfacing ─────────────────────────────────────────────────────────

/** Swap disclosures are ordinary money warnings — see lib/warnings.ts. */
export type SwapWarning = MoneyWarning;

/** Above this, a swap is large enough to warrant an explicit confirmation. */
export const LARGE_SWAP_USD = 10_000;
/** Price impact beyond this is very likely a thin-liquidity route. */
export const HIGH_IMPACT_PCT = 3;

/**
 * Every warning a user should see before confirming.
 *
 * Returned as data rather than rendered inline so the review screen and the
 * swap screen cannot drift, and so the set is unit-testable without mounting a
 * component. Ordered most severe first — a screen showing only the first item
 * still shows the most important one.
 */
export function swapWarnings(input: {
  amountUsd: number;
  priceImpactPct?: number;
  slippagePct?: number;
  fromChain: ChainId;
  toChain: ChainId;
  fromAsset?: SwapAsset;
  toAsset?: SwapAsset;
}): SwapWarning[] {
  const out: SwapWarning[] = [];

  if ((input.priceImpactPct ?? 0) >= HIGH_IMPACT_PCT) {
    out.push({
      id: "price_impact",
      level: "danger",
      title: "High price impact",
      detail: `This trade moves the price by ${input.priceImpactPct!.toFixed(2)}%. You will receive noticeably less than the market rate.`,
    });
  }

  // A cross-chain swap is not a slower same-chain swap — it is a different
  // trust model, and the user is briefly exposed to a bridge.
  if (input.fromChain !== input.toChain) {
    out.push({
      id: "cross_chain",
      level: "warn",
      title: "Crosses chains",
      detail: `Funds move from ${CHAINS[input.fromChain].name} to ${CHAINS[input.toChain].name} through a bridge. This takes longer and cannot be cancelled once started.`,
    });
  }

  if (input.amountUsd >= LARGE_SWAP_USD) {
    out.push({
      id: "large_swap",
      level: "warn",
      title: "Large swap",
      detail: "Consider splitting this into smaller swaps to reduce price impact.",
    });
  }

  for (const asset of [input.fromAsset, input.toAsset]) {
    if (asset?.restriction) {
      out.push({
        id: `restricted_${asset.symbol}`,
        level: "warn",
        title: `${asset.symbol} has restrictions`,
        detail: asset.restriction,
      });
    }
    // Tokenized equities settle against a real venue and are not redeemable
    // 24/7 the way a stablecoin is. Saying so up front avoids a support ticket.
    if (asset && (asset.assetClass === "equity" || asset.assetClass === "etf")) {
      out.push({
        id: `tokenized_${asset.symbol}`,
        level: "info",
        title: `${asset.symbol} is a tokenized asset`,
        detail: `Issued by ${asset.issuer ?? "a third party"} and backed by ${asset.underlying ?? "the underlying security"}. Merchant settlement converts it to USDC first.`,
      });
    }
  }

  return bySeverity(out);
}
