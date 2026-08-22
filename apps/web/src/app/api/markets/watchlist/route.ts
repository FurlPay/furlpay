import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { optionalUser, requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import {
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
  watchlistErrorMessage,
  WATCHLIST_MAX,
  type WatchlistError,
} from "@/lib/watchlist";

// /api/markets/watchlist — the starred symbols for the acting user.
//
// GET is deliberately NOT a 401 for an anonymous reader. /markets is a public
// page and the star renders on every row; a 401 on first paint would put an
// error in the console of a page that is working exactly as designed. Anonymous
// gets `{ authenticated: false, symbols: [] }` and the UI offers sign-in when
// the star is actually pressed.
//
// POST and DELETE do require a session — they write to an account.

function errorStatus(error: WatchlistError): number {
  switch (error) {
    case "invalid_symbol":
    case "unknown_symbol":
      return 400;
    case "limit_reached":
      return 409;
    case "unavailable":
      return 503;
  }
}

export async function GET(req: NextRequest) {
  const auth = await optionalUser(req);
  // A credential was offered and REJECTED (expired, revoked, locked). Passing
  // that through as "anonymous" would silently drop a signed-in user's list;
  // the 401 is what tells the client its session ended.
  if (auth.kind === "rejected") return auth.res;
  if (auth.kind === "anonymous") {
    return NextResponse.json({ authenticated: false, symbols: [], max: WATCHLIST_MAX });
  }
  const symbols = await getWatchlist(auth.account.user.id);
  return NextResponse.json({ authenticated: true, symbols, max: WATCHLIST_MAX });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "markets.watchlist.write", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as { symbol?: unknown } | null;
  const result = await addToWatchlist(auth.account.user.id, body?.symbol);
  if (!result.ok) {
    return NextResponse.json(
      { error: watchlistErrorMessage(result.error) },
      { status: errorStatus(result.error) }
    );
  }
  return NextResponse.json({ authenticated: true, symbols: result.symbols, max: WATCHLIST_MAX });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "markets.watchlist.write", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  // The symbol may come in the body (fetch with a JSON payload) or the query
  // string (a plain DELETE). Accept both rather than making the caller guess.
  const body = (await req.json().catch(() => null)) as { symbol?: unknown } | null;
  const symbol = body?.symbol ?? req.nextUrl.searchParams.get("symbol");

  const result = await removeFromWatchlist(auth.account.user.id, symbol);
  if (!result.ok) {
    return NextResponse.json(
      { error: watchlistErrorMessage(result.error) },
      { status: errorStatus(result.error) }
    );
  }
  return NextResponse.json({ authenticated: true, symbols: result.symbols, max: WATCHLIST_MAX });
}
