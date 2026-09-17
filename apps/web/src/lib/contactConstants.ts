import type { Chain } from "@furlpay/types";
import type { AddressChainKind } from "@/lib/addressValidation";

// ---------------------------------------------------------------------------
// The parts of the address-book contract that BOTH sides need.
//
// Split out of lib/contacts.ts because that module imports `crypto` and
// `next/server` and must never reach a browser bundle — but the palette, the
// chain list and the limits are exactly what the UI has to agree with the
// server about. Duplicating them in a component is how the picker ends up
// offering a colour or a chain the API then rejects with a 400, so they live
// here once and lib/contacts.ts re-exports them for server callers.
//
// Everything in this file must stay pure and dependency-free.
// ---------------------------------------------------------------------------

/**
 * Chains a contact address may declare — every chain FurlPay knows, and only
 * those.
 *
 * This list was originally written by hand in the contacts routes and included
 * `optimism`, which is NOT in the `Chain` union: the API happily accepted and
 * stored an address on a network nothing else in the app can pay, and the
 * `as Chain` cast at the call site hid it from the compiler. Hence both guards
 * below — `satisfies` rejects a chain that does not exist, and the exhaustive
 * check rejects a chain the app supports but the address book forgot.
 */
export const CHAINS = [
  "ethereum",
  "polygon",
  "base",
  "arbitrum",
  "arc",
  "solana",
  "gnosis",
  "robinhood",
  "bsc",
] as const satisfies readonly Chain[];

/** Compile error if a member of `Chain` is missing from CHAINS above. */
type MissingChain = Exclude<Chain, (typeof CHAINS)[number]>;
const _chainsAreExhaustive: MissingChain extends never ? true : MissingChain = true;
void _chainsAreExhaustive;

/** Palette the UI offers. Constrained so the value is safe to interpolate into
 *  a style attribute (AGENTS.md rule 7 territory). */
export const AVATAR_COLORS = [
  "#3B82F6", "#06B6D4", "#A78BFA", "#8B5CF6",
  "#D946EF", "#6366F1", "#7C3AED", "#EC4899",
  "#EF4444", "#EAB308", "#22C55E", "#16A34A",
] as const;

/** Mirrors the database CHECK in migration 0010. */
export const MAX_ADDRESSES_PER_CONTACT = 20;

/**
 * Per-account ceiling. Contacts are loaded whole on every account read, so an
 * unbounded book makes every request slower for the one user who abuses it.
 */
export const MAX_CONTACTS = 500;

export const MAX_NAME_LENGTH = 64;

/** Narrow an untrusted query-string value to a supported chain. A type guard
 *  rather than a check-then-cast, so a route cannot validate one value and then
 *  assert a different one. */
export function isContactChain(value: string | null | undefined): value is Chain {
  return typeof value === "string" && (CHAINS as readonly string[]).includes(value);
}

/** Which chain family a chain id belongs to. Solana is the only non-EVM one. */
export function chainKind(chain: Chain): AddressChainKind {
  return chain === "solana" ? "solana" : "evm";
}

/** Normalised comparison key. EVM addresses are case-insensitive (EIP-55 is a
 *  checksum, not an identity); base58 is case-SENSITIVE and must not be folded. */
export function addressKey(address: string, chain: Chain): string {
  const trimmed = address.trim();
  const normalised = chainKind(chain) === "evm" ? trimmed.toLowerCase() : trimmed;
  return `${chain}:${normalised}`;
}
