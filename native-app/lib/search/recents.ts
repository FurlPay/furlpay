import { cacheGet, cacheSet } from "@/lib/db";

// ---------------------------------------------------------------------------
// Recent searches.
//
// STORED IN kv_cache, FOR THE SAME REASON RECIPIENTS ARE (see
// lib/send/recipients.ts). What someone searched for is account-scoped
// behavioural data — "AAPL", "rent", a counterparty's name — and `kv_cache` is
// wiped by `clearAllCaches()` on both edges of a session. SecureStore survives
// sign-out, which is exactly the wrong property: a second account on a shared
// device must never be shown the first account's search history.
//
// SCOPED BY NAMESPACE so the markets search and the transaction search keep
// separate histories. Offering "AAPL" while someone is filtering transactions
// is noise, and offering a payee's name in a stock search is worse than noise.
// ---------------------------------------------------------------------------

const LIMIT = 6;
const MAX_LEN = 64;

const keyFor = (namespace: string) => `search:recents:${namespace}`;

/** Most recent first. Never throws — a corrupt row degrades to "no history". */
export function listRecentSearches(namespace: string): string[] {
  try {
    const row = cacheGet<string[]>(keyFor(namespace));
    if (!row || !Array.isArray(row.value)) return [];
    return row.value
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

/**
 * Record a search.
 *
 * Case-insensitive de-duplication, because "aapl" and "AAPL" are the same
 * search to a human and two entries to a `Set`. The existing casing is
 * replaced by the newest, so the list reflects how the user last typed it.
 */
export function rememberSearch(namespace: string, raw: string): string[] {
  const term = String(raw ?? "").trim().slice(0, MAX_LEN);
  /* One or two characters is a keystroke on the way somewhere, not a search
     worth remembering. */
  if (term.length < 2) return listRecentSearches(namespace);

  try {
    const existing = listRecentSearches(namespace);
    const lower = term.toLowerCase();
    const next = [term, ...existing.filter((s) => s.toLowerCase() !== lower)].slice(0, LIMIT);
    cacheSet(keyFor(namespace), next);
    return next;
  } catch {
    /* Storage is a convenience here; failing to persist must never break the
       search the user is in the middle of. */
    return listRecentSearches(namespace);
  }
}

/** Drop one entry — the per-row dismiss. */
export function forgetSearch(namespace: string, term: string): string[] {
  try {
    const lower = String(term ?? "").toLowerCase();
    const next = listRecentSearches(namespace).filter((s) => s.toLowerCase() !== lower);
    cacheSet(keyFor(namespace), next);
    return next;
  } catch {
    return listRecentSearches(namespace);
  }
}

/** Clear the whole history for one namespace. */
export function clearRecentSearches(namespace: string): void {
  try {
    cacheSet(keyFor(namespace), []);
  } catch {
    /* nothing to do */
  }
}
