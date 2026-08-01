import { shortAddress } from "@/lib/format";
import type { Chain } from "@/lib/types";

// ---------------------------------------------------------------------------
// Address-poisoning detection.
//
// Kept in its own module, with no storage dependency, for two reasons: it is
// pure logic that deserves direct unit tests, and it must stay usable no matter
// where the payee history comes from.
//
// HOW THE ATTACK WORKS. An attacker mines a vanity address whose first and last
// characters match one the victim really uses, then sends a dust transfer from
// it so it lands in the victim's history. Later the victim copies "their"
// address from that history — glances at `0x1a2b…9f3c`, sees a match — and pays
// the attacker. Every check the victim performed passed.
//
// THE DETECTION IS THEREFORE THE TRUNCATION ITSELF. Two distinct addresses that
// collapse to the same `shortAddress()` string are the exact signature of the
// attack, because that string is what a human actually compares. Any other
// heuristic (edit distance, shared prefix length) would be guessing at what the
// attacker optimised for; this one measures it directly.
// ---------------------------------------------------------------------------

export interface RecentRecipient {
  address: string;
  chain: Chain;
  /** The asset last sent to this address — a hint, not a constraint. */
  token: string;
  lastUsedAt: number;
  count: number;
}

/** How the UI abbreviates an address everywhere it is not shown in full. */
export const SHORT_CHARS = 6;

export function isKnownRecipient(address: string, recents: RecentRecipient[]): boolean {
  const t = address.trim().toLowerCase();
  return !!t && recents.some((r) => r.address.toLowerCase() === t);
}

/**
 * A previously-used address that RENDERS IDENTICALLY to this one.
 *
 * Returns the RECENT (trusted) entry rather than a boolean, so the warning can
 * show the user which of their own payees this address is imitating.
 *
 * Comparison is case-insensitive: EVM addresses are hex and are displayed in
 * mixed-case checksum form in some apps and lower-case in others, so a
 * case-sensitive check would miss the very substitution it is looking for.
 */
export function findLookalike(
  address: string,
  recents: RecentRecipient[]
): RecentRecipient | undefined {
  const target = address.trim().toLowerCase();
  if (!target) return undefined;
  const short = shortAddress(target, SHORT_CHARS);
  return recents.find((r) => {
    const known = r.address.toLowerCase();
    return known !== target && shortAddress(known, SHORT_CHARS) === short;
  });
}
