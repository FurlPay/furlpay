import { CATALOG, bySymbol, assetLogoPath, type MarketAsset } from "./catalog";
import universeData from "./universe.json";

// ---------------------------------------------------------------------------
// The investable universe = synced broker inventory + curated enrichment.
//
// Two sources, deliberately kept separate:
//
//   universe.json  WHICH assets exist and are tradable. Synced from Alpaca
//                  /v2/assets by scripts/sync-assets.mjs (~13k listed-exchange
//                  equities and ETFs). Machine-owned; never hand-edited.
//   catalog.ts     WHAT WE KNOW about the notable ones — sector, industry,
//                  market-cap tier, logo, CoinGecko id, crypto entries.
//                  Human-owned; Alpaca supplies none of this.
//
// Merging rather than replacing is the point. Dropping the catalog would lose
// every logo and sector; dropping the universe would keep the old failure where
// an asset nobody had hand-typed simply did not exist — the reason SK Hynix and
// thousands of real listings were missing from the web app, extension, Android
// app and watch simultaneously.
//
// COVERAGE NOTE: this is US-listed only. Non-US primary listings (SK Hynix on
// the KRX, Toyota on the TSE) are still absent, and they cannot be added here
// safely until prices carry a currency — see the `currency` field below.
// ---------------------------------------------------------------------------

export interface UniverseAsset {
  symbol: string;
  name: string;
  exchange: string;
  /** Whether the broker supports fractional orders — gates the $1 minimum. */
  fractionable: boolean;
  shortable: boolean;
  marginable: boolean;
}

interface UniverseFile {
  syncedAt: string;
  source: string;
  assets: UniverseAsset[];
}

const file = universeData as UniverseFile;

/** When the tradable list was last synced (ISO). Surfaced so a stale universe
 *  is visible in ops rather than silently ageing. */
export const UNIVERSE_SYNCED_AT = file.syncedAt;

export const UNIVERSE: readonly UniverseAsset[] = file.assets;

const universeBySymbol = new Map(UNIVERSE.map((a) => [a.symbol, a]));

/** Is this symbol actually tradable at the broker right now? */
export function isTradable(symbol: string): boolean {
  return universeBySymbol.has(symbol.toUpperCase());
}

export function universeAsset(symbol: string): UniverseAsset | undefined {
  return universeBySymbol.get(symbol.toUpperCase());
}

/**
 * A searchable asset: everything in the tradable universe, enriched with
 * curated metadata where we have it, plus the curated crypto entries (which
 * Alpaca's equity universe naturally does not contain).
 */
export interface MergedAsset {
  symbol: string;
  name: string;
  kind: MarketAsset["kind"];
  sector: string | null;
  industry: string | null;
  cap: string;
  chain: string | null;
  logo: string;
  exchange: string | null;
  fractionable: boolean;
  /** True when curated metadata exists — drives ranking, since a hand-curated
   *  asset is far likelier to be what a user searching "AA" actually means. */
  curated: boolean;
  /** ISO-4217 of the asset's listing. Every synced asset is US-listed, so this
   *  is USD today. It exists so a future non-USD listing CANNOT be added
   *  without a deliberate decision about FX — a KRW price rendered as USD is a
   *  ~1,375x error, which is worse than the asset being missing. */
  currency: "USD";
}

function merge(u: UniverseAsset): MergedAsset {
  const curated = bySymbol.get(u.symbol);
  return {
    symbol: u.symbol,
    name: curated?.name ?? u.name,
    // Alpaca lumps ETFs into us_equity; trust the curated kind when known and
    // fall back to the exchange hint (ARCA/BATS list predominantly ETFs).
    kind: curated?.kind ?? (u.exchange === "ARCA" || u.exchange === "BATS" ? "etf" : "stock"),
    sector: curated?.sector ?? null,
    industry: curated?.industry ?? null,
    cap: curated?.cap ?? "small",
    chain: curated?.chain ?? null,
    logo: (curated ? assetLogoPath(curated) : "") ?? "",
    exchange: u.exchange,
    fractionable: u.fractionable,
    curated: !!curated,
    currency: "USD",
  };
}

/** The curated crypto set, which lives only in catalog.ts. */
const CRYPTO: MergedAsset[] = CATALOG.filter((a) => a.kind === "crypto").map((a) => ({
  symbol: a.symbol,
  name: a.name,
  kind: a.kind,
  sector: a.sector ?? null,
  industry: a.industry ?? null,
  cap: a.cap ?? "small",
  chain: a.chain ?? null,
  logo: assetLogoPath(a) ?? "",
  exchange: null,
  fractionable: true,
  curated: true,
  currency: "USD",
}));

/**
 * Search the full universe.
 *
 * Ranking matters more here than in a 391-row list: "AA" now matches Alcoa
 * plus dozens of CLO ETFs. Order is exact symbol, then curated assets, then
 * symbol prefix, then name — so a household name never sorts below an obscure
 * fund that happens to share a prefix.
 */
export function searchUniverse(
  query: string,
  opts: { kind?: MarketAsset["kind"]; limit?: number; fractionableOnly?: boolean } = {}
): MergedAsset[] {
  const q = query.trim().toUpperCase();
  const limit = opts.limit ?? 50;

  let pool: MergedAsset[];
  if (opts.kind === "crypto") {
    pool = CRYPTO;
  } else if (!q) {
    // No query: curated assets only. Returning 13k rows unranked would be
    // noise, and the curated set is the editorially meaningful default.
    pool = [...CRYPTO, ...UNIVERSE.filter((u) => bySymbol.has(u.symbol)).map(merge)];
  } else {
    pool = [...CRYPTO, ...UNIVERSE.map(merge)];
  }

  let rows = pool;
  if (opts.kind) rows = rows.filter((a) => a.kind === opts.kind);
  if (opts.fractionableOnly) rows = rows.filter((a) => a.fractionable);

  if (!q) return rows.slice(0, limit);

  const scored: { a: MergedAsset; score: number }[] = [];
  for (const a of rows) {
    const sym = a.symbol.toUpperCase();
    const name = a.name.toUpperCase();
    let score = -1;
    if (sym === q) score = 0;
    else if (a.curated && sym.startsWith(q)) score = 1;
    else if (sym.startsWith(q)) score = 2;
    else if (a.curated && name.includes(q)) score = 3;
    else if (name.includes(q)) score = 4;
    else if (sym.includes(q)) score = 5;
    if (score >= 0) scored.push({ a, score });
  }
  scored.sort((x, y) => x.score - y.score || x.a.symbol.localeCompare(y.a.symbol));
  return scored.slice(0, limit).map((s) => s.a);
}

/** The asset behind `/markets/<symbol>`, curated or not.
 *
 * The detail route used to resolve through `bySymbol`, which holds only the 391
 * hand-curated entries. Search, meanwhile, ranks over all 12,970 tradable
 * symbols — so searching "Alcoa" returned AA, and following it produced "Asset
 * not found". Every uncurated listing was reachable, linkable and dead: 12,655
 * of them, including S&P 500 members like Agilent, Alcoa and Albemarle.
 *
 * Curated metadata was never what made those pages possible. Price, range and
 * volume come from the ticker alone, and fundamentals from EDGAR's own
 * ticker-to-CIK map; the catalog contributes a logo, a sector and a cap tier.
 * Those are enrichments, and their absence is a thinner page rather than no
 * page — so resolution falls through to the universe, and the sections that
 * need curation drop out on their own.
 *
 * Crypto is checked first because it lives only in the catalog. `bySymbol`
 * already resolves a bare ambiguous ticker (STX, DASH) toward the security. */
export function resolveMergedAsset(symbol: string): MergedAsset | undefined {
  const upper = symbol.toUpperCase();

  const curated = bySymbol.get(upper);
  if (curated?.kind === "crypto") return CRYPTO.find((c) => c.symbol === upper);

  const u = universeBySymbol.get(upper);
  if (u) return merge(u);

  // Curated but absent from the broker's list — 74 entries, mostly crypto and
  // a few delisted or renamed tickers. Still a real page.
  if (curated) {
    return {
      symbol: curated.symbol,
      name: curated.name,
      kind: curated.kind,
      sector: curated.sector ?? null,
      industry: curated.industry ?? null,
      cap: curated.cap ?? "small",
      chain: curated.chain ?? null,
      logo: assetLogoPath(curated) ?? "",
      exchange: null,
      fractionable: true,
      curated: true,
      currency: "USD",
    };
  }
  return CRYPTO.find((c) => c.symbol === upper);
}

/** Universe counts for ops/monitoring. */
export function universeStats() {
  return {
    syncedAt: UNIVERSE_SYNCED_AT,
    tradable: UNIVERSE.length,
    fractionable: UNIVERSE.filter((a) => a.fractionable).length,
    curated: CATALOG.length,
    crypto: CRYPTO.length,
  };
}
