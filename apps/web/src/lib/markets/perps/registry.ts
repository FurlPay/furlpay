// ---------------------------------------------------------------------------
// The USDT-margined perpetual futures this app tracks.
//
// ── EVERY DATE HERE CAME FROM BINANCE, NOT FROM A SUMMARY ──────────────────
//
// `listedAt` is Binance's own `onboardDate` from GET /fapi/v1/exchangeInfo,
// read on 2026-09-03. That matters because the research note this list arrived
// with had nine of these twelve dates wrong — some by a year, some attributed
// to exchanges that do not list the pair — and an "age" feature computed from
// a wrong listing date silently poisons every model built on top of it.
//
// If a date here is ever in doubt, re-read exchangeInfo. Do not "correct" it
// from a secondary source.
//
// ── A PERP IS NOT A COIN ───────────────────────────────────────────────────
//
// These are deliberately NOT entries in lib/markets/catalog.ts. That catalog
// describes assets you can hold: it carries a CoinGecko id, a market cap tier
// and a sector. A perpetual has none of those — it has a mark price, an index
// price, a funding rate and open interest, it can trade at a price its
// underlying never touches, and it is a leveraged derivative rather than a
// holding. Putting BZUSDT in the same list as BTC-the-asset would make a
// Brent-crude derivative render as something you can own a fraction of.
//
// BZUSDT is the clearest example: the underlying is BRENT CRUDE OIL, not a
// token. It has no CoinGecko id and never will.
// ---------------------------------------------------------------------------

export interface PerpSpec {
  /** Binance USDT-M symbol, e.g. "BZUSDT". */
  symbol: string;
  /** Ticker of the underlying, for display: "BZ", "BTC". */
  base: string;
  /** Human name of the underlying. */
  name: string;
  /** What the contract actually tracks. */
  underlying: "crypto" | "commodity";
  /**
   * Binance `onboardDate`, ISO. When the CONTRACT started trading — not when
   * the token launched. The two are different facts and conflating them is how
   * the source note got most of this table wrong.
   */
  listedAt: string;
  /** Accent used for the generated symbol mark. */
  accent: string;
}

/**
 * The twelve pairs, in the order they appear on the exchange screen.
 *
 * Verified present and TRADING on Binance USDT-M futures (893 symbols) on
 * 2026-09-03. All twelve exist; none had to be dropped.
 */
export const PERPS: PerpSpec[] = [
  { symbol: "BZUSDT", base: "BZ", name: "Brent Oil", underlying: "commodity", listedAt: "2026-04-01", accent: "#D4A017" },
  { symbol: "BTCUSDT", base: "BTC", name: "Bitcoin", underlying: "crypto", listedAt: "2019-09-08", accent: "#F7931A" },
  { symbol: "ETHUSDT", base: "ETH", name: "Ethereum", underlying: "crypto", listedAt: "2019-11-27", accent: "#8A92B2" },
  { symbol: "BNBUSDT", base: "BNB", name: "BNB", underlying: "crypto", listedAt: "2020-02-10", accent: "#F3BA2F" },
  { symbol: "AKEUSDT", base: "AKE", name: "Akedo", underlying: "crypto", listedAt: "2025-09-26", accent: "#5B8DEF" },
  { symbol: "HEMIUSDT", base: "HEMI", name: "Hemi", underlying: "crypto", listedAt: "2025-08-29", accent: "#FF6B4A" },
  { symbol: "TUSDT", base: "T", name: "Threshold", underlying: "crypto", listedAt: "2023-01-31", accent: "#4ECDC4" },
  { symbol: "MUBARAKUSDT", base: "MUBARAK", name: "Mubarak", underlying: "crypto", listedAt: "2025-03-17", accent: "#2ECC71" },
  { symbol: "BULLAUSDT", base: "BULLA", name: "Bulla", underlying: "crypto", listedAt: "2025-07-04", accent: "#E84393" },
  { symbol: "EDGEUSDT", base: "EDGE", name: "edgeX", underlying: "crypto", listedAt: "2026-03-19", accent: "#00B8D9" },
  { symbol: "MAGMAUSDT", base: "MAGMA", name: "Magma", underlying: "crypto", listedAt: "2025-12-31", accent: "#E74C3C" },
  { symbol: "BTRUSDT", base: "BTR", name: "Bitlayer", underlying: "crypto", listedAt: "2025-08-27", accent: "#9B59B6" },
];

export const PERP_SYMBOLS = PERPS.map((p) => p.symbol);

export function perpBySymbol(symbol: string): PerpSpec | null {
  const s = symbol.trim().toUpperCase();
  return PERPS.find((p) => p.symbol === s) ?? null;
}

/**
 * Days since the contract listed.
 *
 * Returns null rather than a number for an unparseable date: an age feature
 * that silently reads 0 makes a two-year-old contract look brand new, which is
 * the exact direction that would mislead.
 */
export function contractAgeDays(spec: PerpSpec, now = new Date()): number | null {
  const t = Date.parse(spec.listedAt);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  return days >= 0 ? days : null;
}
