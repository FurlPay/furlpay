// ---------------------------------------------------------------------------
// The user watchlist — the starred symbols behind /markets.
//
// WHERE IT LIVES, and why not Postgres. The account record is a relational
// schema (lib/storeDb.ts writes explicit columns), so a new field on it is a
// new migration — and migration 0010 is still not applied anywhere, which
// means a watchlist column added today would be a feature that silently does
// nothing in production. The durable KV (Upstash Redis, live in prod) is
// already the home for cross-instance user state that is not money, so the
// list lives at `watchlist:<userId>` with no TTL.
//
// What that trades away, stated plainly: a watchlist is a preference list, not
// a ledger. If Redis loses the key the user loses an ordering they can rebuild
// in a minute, and no balance, position or entitlement is affected. If this
// ever needs to be a first-class account field, the shape below is already the
// one a column would hold.
//
// Every mutation is bounded: symbols are validated against the real universe
// before they are stored, so the list cannot be used as arbitrary user-content
// storage, and it is capped so one account cannot grow it without limit.
// ---------------------------------------------------------------------------

import { kvDel, kvGet, kvSet } from "@/lib/kv";
import { isPlausibleTicker, resolveAsset } from "@/lib/markets/resolve";

/** How many symbols one account may star. Generous for a person, bounded for
 *  a script. */
export const WATCHLIST_MAX = 250;

const key = (userId: string) => `watchlist:${userId}`;

/** Normalise a client-supplied symbol. Returns null when it could not be one. */
export function normalizeSymbol(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (!s || s.length > 20) return null;
  return isPlausibleTicker(s) ? s : null;
}

/**
 * The stored list, most recently added FIRST.
 *
 * Reads never throw. A KV outage returns an empty list and the star renders
 * un-filled — annoying, and honest — rather than taking the markets page down
 * with it.
 */
export async function getWatchlist(userId: string): Promise<string[]> {
  try {
    const stored = await kvGet<unknown>(key(userId));
    if (!Array.isArray(stored)) return [];
    const out: string[] = [];
    for (const entry of stored) {
      const s = normalizeSymbol(entry);
      if (s && !out.includes(s)) out.push(s);
    }
    return out.slice(0, WATCHLIST_MAX);
  } catch {
    return [];
  }
}

export type WatchlistError = "invalid_symbol" | "unknown_symbol" | "limit_reached" | "unavailable";

export type WatchlistResult =
  | { ok: true; symbols: string[] }
  | { ok: false; error: WatchlistError };

/**
 * Star a symbol.
 *
 * The symbol is resolved against the tradable universe BEFORE it is written.
 * Without that check the endpoint stores whatever string it is handed, and the
 * watchlist tab then renders rows for assets that do not exist — which reads as
 * a broken product rather than a rejected input.
 *
 * Adding an already-starred symbol succeeds and does not reorder the list, so
 * a double-tap or a replayed request is a no-op rather than a duplicate.
 */
export async function addToWatchlist(userId: string, rawSymbol: unknown): Promise<WatchlistResult> {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) return { ok: false, error: "invalid_symbol" };

  const asset = await resolveAsset(symbol).catch(() => null);
  if (!asset) return { ok: false, error: "unknown_symbol" };

  const current = await getWatchlist(userId);
  if (current.includes(asset.symbol)) return { ok: true, symbols: current };
  if (current.length >= WATCHLIST_MAX) return { ok: false, error: "limit_reached" };

  const next = [asset.symbol, ...current];
  try {
    await kvSet(key(userId), next);
  } catch {
    return { ok: false, error: "unavailable" };
  }
  return { ok: true, symbols: next };
}

/** Un-star a symbol. Removing something absent succeeds — the caller asked for
 *  a state, and that state already holds. */
export async function removeFromWatchlist(
  userId: string,
  rawSymbol: unknown
): Promise<WatchlistResult> {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) return { ok: false, error: "invalid_symbol" };

  const current = await getWatchlist(userId);
  const next = current.filter((s) => s !== symbol);
  if (next.length === current.length) return { ok: true, symbols: current };

  try {
    if (next.length === 0) await kvDel(key(userId));
    else await kvSet(key(userId), next);
  } catch {
    return { ok: false, error: "unavailable" };
  }
  return { ok: true, symbols: next };
}

/** Human-readable reason, for the API response body. */
export function watchlistErrorMessage(error: WatchlistError): string {
  switch (error) {
    case "invalid_symbol":
      return "That is not a valid symbol.";
    case "unknown_symbol":
      return "We could not find that asset.";
    case "limit_reached":
      return `A watchlist holds up to ${WATCHLIST_MAX} assets. Remove one to add another.`;
    case "unavailable":
      return "Your watchlist could not be saved. Try again.";
  }
}
