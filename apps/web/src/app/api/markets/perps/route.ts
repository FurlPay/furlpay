import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getPerpQuotes, probeUpstream } from "@/lib/markets/perps/binance";
import { PERPS } from "@/lib/markets/perps/registry";

export const dynamic = "force-dynamic";

// ── WHY THIS ROUTE RUNS IN FRANKFURT ───────────────────────────────────────
//
// Binance answers HTTP 451 ("Unavailable For Legal Reasons") to requests from
// US IP addresses, and Vercel's default Function region for this project is
// iad1 — Washington DC. The symptom is nasty because it is invisible in every
// other environment: the code works locally, works in CI, and returns an empty
// quote list in production with no error anywhere.
//
// So this route is pinned outside the restricted jurisdiction and, with
// ./bars, is the ONLY place that talks to Binance. Everything else — including
// the instrument page — goes through it, which keeps the other 13,000 market
// pages serving from the US region their readers are in.
//
// The pin lives in apps/web/vercel.json under `functions`, NOT here. Next's
// `export const preferredRegion` is deprecated, and on Vercel it only accepts
// 'auto' | 'global' | 'home' — a region code like "fra1" is rejected, so the
// export that used to sit on this line could never have moved the function.

// GET /api/markets/perps — live quotes for the tracked USDT-M perpetuals.
//
// Public and unauthenticated, like the rest of /api/markets: these are exchange
// prices, not account data. Rate-limited because each miss reaches Binance, and
// the middleware baseline only throttles mutating methods.
//
// `?symbols=BZUSDT,BTCUSDT` narrows the list. Unknown symbols are ignored
// rather than erroring — the registry is the allowlist, so this cannot be used
// to proxy arbitrary requests at Binance.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "markets.perps", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const raw = req.nextUrl.searchParams.get("symbols");
  const requested = raw
    ? raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, PERPS.length)
    : undefined;

  const quotes = await getPerpQuotes(requested);

  // Nothing priced at all is worth one extra request to find out why. An empty
  // list used to come back as a cheerful 200, which is how a region block
  // survived in production: the page rendered em-dashes, the route looked
  // healthy, and no log anywhere said the word "Binance".
  if (quotes.length === 0) {
    const upstream = await probeUpstream();
    if (!upstream.reachable) {
      return NextResponse.json(
        { tracked: PERPS.length, returned: 0, quotes: [], upstream },
        // 503, not 200: this is our dependency failing, and a caller retrying
        // later is the correct response to it. Explicitly uncached — caching a
        // provider outage keeps serving it after the provider recovers.
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    // Reachable and still nothing: the requested symbols are simply not ones we
    // track. That is a 200 with an empty list, which is what it has always been.
  }

  return NextResponse.json(
    {
      // Reported so a caller can tell "the provider is down" from "we track
      // fewer contracts than you asked for".
      tracked: PERPS.length,
      returned: quotes.length,
      quotes,
    },
    {
      headers: {
        // Short shared cache: the underlying fetch is already cached for 10s,
        // and this stops a burst of readers each triggering their own miss.
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
      },
    }
  );
}
