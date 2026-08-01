import { cacheGet, cacheSet } from "@/lib/db";
import type { Chain } from "@/lib/types";
import type { RecentRecipient } from "./lookalike";

export type { RecentRecipient } from "./lookalike";
export { findLookalike, isKnownRecipient } from "./lookalike";

// ---------------------------------------------------------------------------
// Recent recipients — storage only. The address logic that reads this list
// lives in ./lookalike, which has no storage dependency so it can be tested
// directly.
//
// WHY THEY ARE STORED IN kv_cache AND NOT SecureStore. This list is convenience
// data, not a credential — but it IS account-scoped, and `clearAllCaches()`
// wipes kv_cache on both edges of a session (lib/auth.ts clearSessionState).
// Putting it here means a second account signing in on the same device can
// never be offered the first account's payees. SecureStore survives sign-out,
// which is exactly the wrong property for this.
//
// WHY A RECENTS LIST IS A SAFETY FEATURE AND NOT JUST A SHORTCUT. Address
// poisoning works by getting a look-alike address into the user's history and
// waiting for them to copy the wrong one. Holding the real history is what
// makes `findLookalike` below possible — without it the app has nothing to
// compare a new address against.
// ---------------------------------------------------------------------------

const KEY = "send:recents";
const LIMIT = 8;

export function listRecentRecipients(): RecentRecipient[] {
  try {
    const row = cacheGet<RecentRecipient[]>(KEY);
    if (!row || !Array.isArray(row.value)) return [];
    // Defensive: a shape change or a corrupt row must degrade to "no recents",
    // never to a crash on the Send tab.
    return row.value.filter(
      (r): r is RecentRecipient => !!r && typeof r.address === "string" && r.address.length > 0
    );
  } catch {
    return [];
  }
}

/** Record a completed send. Most recent first; the same address is promoted
 *  rather than duplicated, and its use count carries over. */
export function rememberRecipient(input: {
  address: string;
  chain: Chain;
  token: string;
}): RecentRecipient[] {
  const address = input.address.trim();
  if (!address) return listRecentRecipients();

  const existing = listRecentRecipients();
  const prior = existing.find((r) => r.address.toLowerCase() === address.toLowerCase());
  const next: RecentRecipient[] = [
    {
      address,
      chain: input.chain,
      token: input.token,
      lastUsedAt: Date.now(),
      count: (prior?.count ?? 0) + 1,
    },
    ...existing.filter((r) => r.address.toLowerCase() !== address.toLowerCase()),
  ].slice(0, LIMIT);

  try {
    cacheSet(KEY, next);
  } catch {
    // A failed write costs a convenience row, never a send.
  }
  return next;
}
