import type { Chain } from "@/lib/types";

// ---------------------------------------------------------------------------
// Memos and destination tags.
//
// NONE OF THE EIGHT CHAINS FURLPAY SUPPORTS TODAY USES ONE. Every one is EVM or
// Solana, and on both the address IS the whole destination. So this module
// renders no UI, adds no field to any request, and changes nothing that
// currently happens. That is the correct behaviour and the file says so up
// front, because a memo input on an Ethereum address would be a field that
// cannot do anything, on the screen where a confusing field costs the most.
//
// WHY IT EXISTS ANYWAY. On XRP, Stellar, Cosmos-family chains and several
// exchange deposit addresses, the memo is not optional decoration — it is how
// the receiving institution knows WHOSE account to credit. An address saved
// without one is an address that takes the money and never credits it, and the
// user's only evidence is a successful transaction. Tangem models this per
// blockchain (`AddressMemoValidator`) for exactly that reason.
//
// The expensive version of adding it later is discovering, on the day XRP is
// switched on, that `ContactAddress` has no field for it, that a stored address
// cannot be migrated to acquire one, and that every existing row is ambiguous
// between "no memo needed" and "memo not recorded". This module makes that
// addition cheap:
//
//   1. `memoRequirement` is EXHAUSTIVE over `Chain`. Adding a chain to the
//      union is a compile error here until somebody states what that chain does
//      about memos. The decision cannot be forgotten, which is the failure mode
//      that produces the ambiguous rows.
//   2. The serialized shape is fixed now (`memo?: string`, absent when there is
//      none) and documented, so a stored address written today is forward
//      compatible with one written after XRP ships — absent means "this chain
//      has no memo", never "we did not record it", because a chain that needs
//      one cannot be added without passing through rule 1.
//   3. Validation is per chain and lives beside the requirement, so the rule
//      and the check cannot drift apart.
// ---------------------------------------------------------------------------

/**
 * What a chain does about the second half of a destination.
 *
 *   none      — the address is the whole destination (every chain today).
 *   optional  — accepted and forwarded when present.
 *   required  — a transfer without one is likely to be lost. The UI must not
 *               let an address be saved without it.
 */
export type MemoRequirement = "none" | "optional" | "required";

/** How a chain's second field is named to a user. "Memo" and "destination tag"
 *  are not interchangeable words to anyone who has used the chain in question,
 *  and telling an XRP user to enter a "memo" is telling them the wrong thing. */
export type MemoKind = "memo" | "destination_tag";

export interface MemoSpec {
  requirement: MemoRequirement;
  kind: MemoKind;
  /** What the field accepts, checked before anything is stored. */
  pattern: RegExp;
  maxLength: number;
  /** Shown under the field. */
  hint: string;
}

/** The `none` spec, shared by every chain FurlPay supports today. */
const NO_MEMO: MemoSpec = {
  requirement: "none",
  kind: "memo",
  // Never used while `requirement` is "none"; a pattern that matches nothing
  // is the safe default, so a caller that ignores the requirement and validates
  // anyway rejects rather than accepts.
  pattern: /^$/,
  maxLength: 0,
  hint: "",
};

/**
 * The memo rule for a chain.
 *
 * EXHAUSTIVE BY CONSTRUCTION — the `satisfies` below fails to compile if a
 * member of `Chain` is missing. That is the whole mechanism: a new chain cannot
 * reach production without someone answering "does this need a memo?", and the
 * answer being wrong is a code review away rather than a lost deposit away.
 */
const MEMO_BY_CHAIN = {
  ethereum: NO_MEMO,
  polygon: NO_MEMO,
  base: NO_MEMO,
  arbitrum: NO_MEMO,
  gnosis: NO_MEMO,
  robinhood: NO_MEMO,
  bsc: NO_MEMO,
  // Solana has a memo PROGRAM, but it is not part of a destination: an SPL
  // transfer to an address arrives whether or not a memo instruction rides
  // along. Treating it as part of the address would ask users for something
  // that cannot change where their money lands.
  solana: NO_MEMO,
} as const satisfies Record<Chain, MemoSpec>;

export function memoSpec(chain: Chain): MemoSpec {
  return MEMO_BY_CHAIN[chain];
}

export function memoRequirement(chain: Chain): MemoRequirement {
  return MEMO_BY_CHAIN[chain].requirement;
}

/** True when the address form should render a memo field at all. */
export function supportsMemo(chain: Chain): boolean {
  return memoRequirement(chain) !== "none";
}

/**
 * Validate a memo for a chain. Returns null when acceptable.
 *
 * Fails CLOSED on a chain with no memo support: a value supplied there is a
 * client bug or a stale payload, and silently dropping it would store an
 * address that the sender believes carries routing information and does not.
 */
export function memoError(chain: Chain, memo: string | undefined): string | null {
  const spec = memoSpec(chain);
  const value = (memo ?? "").trim();

  if (spec.requirement === "none") {
    return value ? "This network doesn't use a memo or destination tag." : null;
  }
  if (!value) {
    return spec.requirement === "required"
      ? `A ${label(spec.kind)} is required on this network — a transfer without one may not be credited.`
      : null;
  }
  if (value.length > spec.maxLength) {
    return `A ${label(spec.kind)} is at most ${spec.maxLength} characters.`;
  }
  if (!spec.pattern.test(value)) {
    return `That isn't a valid ${label(spec.kind)} for this network.`;
  }
  return null;
}

export function label(kind: MemoKind): string {
  return kind === "destination_tag" ? "destination tag" : "memo";
}

/**
 * The stored form of a memo, for the address payload.
 *
 * ABSENT, NOT EMPTY STRING. `{ memo: "" }` and `{}` would both mean "no memo"
 * to a reader and differ on the wire, and an empty string is the value most
 * likely to be forwarded to a chain as a real memo by some downstream service.
 * One representation only, and it is omission.
 */
export function serializeMemo(chain: Chain, memo: string | undefined): { memo?: string } {
  if (!supportsMemo(chain)) return {};
  const value = (memo ?? "").trim();
  return value ? { memo: value } : {};
}
