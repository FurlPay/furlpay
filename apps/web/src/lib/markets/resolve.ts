// ---------------------------------------------------------------------------
// Resolving a URL segment to an asset.
//
// Three tiers, widening as each one misses:
//
//   catalog     391 hand-curated rows — logo, sector, cap tier, CoinGecko id.
//   universe    12,970 tradable symbols synced from the broker on 2026-07-18.
//   online      anything Yahoo quotes today.
//
// The third tier exists because the second is a snapshot with a date on it.
// `universe.json` was synced once and is re-synced by a script that needs
// working broker credentials — which, as of this writing, 401. Every listing
// since that date is invisible to the local tiers: an IPO, a ticker change, a
// newly launched ETF. Without an online tier those pages 404 until someone
// notices and re-runs a sync.
//
// It is deliberately last. The local tiers are exact, free and instant; the
// online one costs an upstream call and answers a fuzzier question. Consulted
// first it would introduce wrong answers for symbols the catalog already has
// right, which is the same reason `cikByEdgarSearch` sits behind the bulk
// ticker file in sec.ts.
// ---------------------------------------------------------------------------

import { bySymbol } from "./catalog";
import { resolveMergedAsset } from "./universe";
import type { MergedAsset } from "./universe";
import { yahooSymbolFor } from "./providers";
import { quote as yahooQuote } from "./providers/yahoo";
import { cachedJson, TTL } from "./providers/cache";

/** A URL segment that could be a ticker.
 *
 * This is the guard between a path parameter and an outbound request, so it is
 * a strict allowlist rather than a sanitiser: letters, digits, and the dot and
 * dash that share classes, preferreds and pairs actually use. Anything else —
 * a slash, a percent escape, a query string — is not a ticker, and the answer
 * is "no such symbol" rather than a fetch shaped by the caller. */
const TICKER = /^[A-Z0-9]{1,8}(?:[.-][A-Z0-9]{1,4})?$/;

export function isPlausibleTicker(symbol: string): boolean {
  return TICKER.test(symbol.toUpperCase());
}

/** Yahoo's instrument types, mapped to the three kinds this app renders. */
function kindOf(instrumentType: string | null): MergedAsset["kind"] | null {
  switch ((instrumentType ?? "").toUpperCase()) {
    case "EQUITY":
      return "stock";
    case "ETF":
    case "MUTUALFUND":
      return "etf";
    case "CRYPTOCURRENCY":
      return "crypto";
    default:
      return null;
  }
}

/** Ask Yahoo whether this symbol exists, and what it is.
 *
 * Uses the chart endpoint rather than search: a chart response is proof the
 * symbol prices, which is the only property that makes a page worth rendering,
 * and it carries the name, venue, instrument type and currency in one call.
 *
 * Two rejections matter more than the lookup itself:
 *
 * - Non-USD. Nothing in this codebase carries a currency next to a price, so a
 *   London or Frankfurt line of the same company renders its pence or euros
 *   through a dollar-formatted component. That is a silent multi-hundred-
 *   percent error on a page people size positions from, and it is exactly what
 *   `universe.json` stays US-only to avoid.
 * - Instrument types this app cannot price — indices, futures, FX, options.
 *   Admitting them produces a page that looks tradable and is not.
 *
 * The negative answer is cached too. Without that, a crawler walking
 * /markets/AAAA through /markets/ZZZZ turns into one upstream request per
 * miss, against an endpoint that rate-limits by IP and is shared with every
 * other visitor. */
async function lookupOnline(symbol: string): Promise<MergedAsset | null> {
  const upper = symbol.toUpperCase();
  if (!isPlausibleTicker(upper)) return null;

  const cached = await cachedJson<{ hit: MergedAsset | null }>(
    `resolve:${upper}`,
    // A real symbol is worth remembering for hours; a symbol that does not
    // exist is worth remembering for two minutes. `upper` comes from the URL
    // and its only gate is a format regex, so the number of DISTINCT negative
    // keys is chosen by the caller — see TTL.symbolMissing.
    (v) => (v.hit ? TTL.symbolExists : TTL.symbolMissing),
    async () => {
      const q = await yahooQuote(yahooSymbolFor(upper, "stock")).catch(() => null);
      if (!q || typeof q.price !== "number") return { hit: null };
      if ((q.currency ?? "").toUpperCase() !== "USD") return { hit: null };

      const kind = kindOf(q.instrumentType);
      if (!kind) return { hit: null };

      return {
        hit: {
          symbol: upper,
          name: q.name ?? upper,
          kind,
          sector: null,
          industry: null,
          cap: "small",
          chain: null,
          logo: "",
          exchange: q.exchange,
          // Nothing online says whether the broker will fill an order, and the
          // trade sheet reads this. Unknown is the honest answer, and it is the
          // one that does not promise a fill.
          fractionable: false,
          curated: false,
          currency: "USD",
        },
      };
    }
  );
  return cached?.hit ?? null;
}

/** The asset behind `/markets/<symbol>`, from whichever tier knows it. */
export async function resolveAsset(symbol: string): Promise<MergedAsset | null> {
  const local = resolveMergedAsset(symbol);
  if (local) return local;
  return lookupOnline(symbol);
}

/** Whether the local tiers already know a symbol — no network involved.
 *
 * Callers that must stay synchronous (the sitemap, static generation) use this
 * rather than paying an upstream call per candidate. */
export function isLocallyKnown(symbol: string): boolean {
  return !!resolveMergedAsset(symbol) || bySymbol.has(symbol.toUpperCase());
}
