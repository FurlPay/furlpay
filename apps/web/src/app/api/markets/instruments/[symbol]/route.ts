import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { resolveInstrumentOrAlias, assetClassLabel } from "@/lib/markets/instruments";
import { instrumentQuote } from "@/lib/markets/instrumentQuote";
import { rateLimitOr429 } from "@/lib/rateLimit";

// GET /api/markets/instruments/[symbol] — a quote for anything with a price.
//
// This serves the instruments that are NOT securities: gold, the euro, the S&P
// 500, the ten-year yield. They have no CUSIP and no issuer, so they are
// deliberately not reachable through the 13F identity path, which answers "who
// owns this" — a question EURUSD cannot be asked.
//
// Accepts a canonical symbol, an explicit alias or a display name: XAUUSD,
// "gold", EURUSD, "euro dollar". Alias matching is acceptable here because
// these are written-down market conventions, not inferred issuer identity.
//
// Provider symbols do not leak. A caller sees XAUUSD; that it is served by
// COMEX front-month futures is stated in `providerNote` rather than exposed as
// a symbol the UI would have to understand.
export async function GET(req: NextRequest, props: { params: Promise<{ symbol: string }> }) {
  const limited = await rateLimitOr429(req, "markets.instrument", {
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { symbol } = await props.params;
  const inst = resolveInstrumentOrAlias(decodeURIComponent(symbol));
  // No near misses. An unknown symbol is a 404, not the closest thing we have.
  if (!inst) {
    return NextResponse.json({ error: "Unknown instrument" }, { status: 404 });
  }

  const quote = await instrumentQuote(inst).catch(() => null);

  return NextResponse.json({
    instrument: {
      symbol: inst.symbol,
      assetClass: inst.assetClass,
      assetClassLabel: assetClassLabel(inst.assetClass),
      displayName: inst.displayName,
      baseAsset: inst.baseAsset ?? null,
      quoteAsset: inst.quoteAsset ?? null,
      currency: inst.currency,
      exchange: inst.exchange ?? null,
      /** What the provider can actually answer for this instrument. A client
       *  should render an em-dash for an unsupported field rather than a zero. */
      supports: {
        price: inst.priceSupported,
        volume: inst.volumeSupported,
        marketCap: inst.marketCapSupported,
      },
      providerNote: inst.providerNote ?? null,
    },
    // Null when the provider did not answer. Never a zeroed quote.
    quote,
    asOf: new Date().toISOString(),
  });
}
