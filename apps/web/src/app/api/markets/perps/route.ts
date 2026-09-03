import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getPerpQuotes } from "@/lib/markets/perps/binance";
import { PERPS } from "@/lib/markets/perps/registry";

export const dynamic = "force-dynamic";

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
