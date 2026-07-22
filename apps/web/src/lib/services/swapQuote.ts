import { kvDel, kvGet, kvSet, kvSetNx } from "../kv";
import type { SwapQuote } from "./swap";

// ---------------------------------------------------------------------------
// Server-issued swap quotes.
//
// The problem this solves: /api/swaps used to take the SAME parameters twice —
// once to quote, once to execute — and re-quoted at execution time. The price
// the user reviewed and the price they got were therefore two different reads
// of a moving market, with the biometric prompt sitting between them. Nothing
// in the protocol tied them together, so "the rate you agreed to" did not
// exist as a server-side concept.
//
// A quote is now a first-class object: issued with an id, held for a short
// TTL, bound to the user it was issued to, and redeemable EXACTLY ONCE.
// Execution replays the stored quote instead of pricing again, so the number
// on the confirm screen is the number that settles — or the request fails.
//
// The client-side staleness check in the mobile app is a UX affordance on top
// of this; THIS is the enforcement. A client that skips it cannot execute at a
// price the server never issued.
// ---------------------------------------------------------------------------

/** How long an issued quote stays redeemable. Long enough for a biometric
 *  prompt and a round trip, short enough that the price is still the market's.
 *  Mirrors QUOTE_TTL_MS in native-app/app/swap.tsx — keep them in step. */
export const QUOTE_TTL_SECONDS = 30;

/** Slippage above this is refused outright, wherever it came from. Li.Fi's own
 *  defaults are ≤0.5% (see defaultSlippagePct); a quote an order of magnitude
 *  outside that is a malfunction, not a market condition, and must never reach
 *  a confirm screen. Mirrors MAX_SLIPPAGE_PCT in the mobile client. */
export const MAX_SLIPPAGE_PCT = 5;

interface StoredQuote {
  quote: SwapQuote;
  userId: string;
  issuedAt: number;
}

const quoteKey = (id: string) => `swapquote:${id}`;
const redeemKey = (id: string) => `swapquote:redeemed:${id}`;

export interface IssuedQuote {
  quote: SwapQuote;
  quoteId: string;
  /** ISO timestamp after which this quote can no longer be redeemed. */
  expiresAt: string;
}

/**
 * Store a quote against a fresh id and return it for the client to hold.
 * Issuing is cheap and side-effect free — every quote request gets one, and
 * unredeemed ids simply expire.
 */
export async function issueQuote(userId: string, quote: SwapQuote): Promise<IssuedQuote> {
  const quoteId = crypto.randomUUID();
  const issuedAt = Date.now();
  const stored: StoredQuote = { quote, userId, issuedAt };
  await kvSet(quoteKey(quoteId), stored, QUOTE_TTL_SECONDS);
  return {
    quote,
    quoteId,
    expiresAt: new Date(issuedAt + QUOTE_TTL_SECONDS * 1000).toISOString(),
  };
}

export type RedeemResult =
  | { ok: true; quote: SwapQuote }
  | { ok: false; reason: "expired" | "already_used" | "not_yours" };

/**
 * Consume a quote for execution. Fails closed on every ambiguity:
 *
 *  - unknown or expired id  → "expired" (the TTL already removed it)
 *  - issued to another user → "not_yours" (an id is not a bearer token)
 *  - already redeemed       → "already_used"
 *
 * Single-use is enforced by an atomic set-if-absent on a separate marker key,
 * not by read-then-delete: two executions racing the same id would both pass a
 * read-then-delete check and settle twice. Only one caller can win kvSetNx.
 */
export async function redeemQuote(userId: string, quoteId: string): Promise<RedeemResult> {
  const stored = await kvGet<StoredQuote>(quoteKey(quoteId));
  if (!stored) {
    // A successful redemption deletes the quote, so "no quote" is ambiguous:
    // never issued / expired, or spent moments ago. The marker outlives the
    // quote precisely to tell those apart — a user who double-taps deserves
    // "already used", not "expired", because only one of those means their
    // swap went through.
    const spent = await kvGet<{ at: number }>(redeemKey(quoteId));
    return { ok: false, reason: spent ? "already_used" : "expired" };
  }

  // Check ownership BEFORE burning the id, so one user probing ids cannot
  // invalidate another user's live quote.
  if (stored.userId !== userId) return { ok: false, reason: "not_yours" };

  // The atomic gate. Two executions racing the same id both reach here; only
  // one can win the set-if-absent, and the loser settles nothing.
  const won = await kvSetNx(redeemKey(quoteId), { at: Date.now() }, QUOTE_TTL_SECONDS * 4);
  if (!won) return { ok: false, reason: "already_used" };

  await kvDel(quoteKey(quoteId));
  return { ok: true, quote: stored.quote };
}

/** Human-readable 400/409 text for a failed redemption. */
export function redeemErrorMessage(reason: Exclude<RedeemResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "expired":
      return "That quote expired. Request a new one and confirm the current price.";
    case "already_used":
      return "That quote was already used. Request a new one.";
    case "not_yours":
      return "That quote was not issued to this account.";
  }
}
