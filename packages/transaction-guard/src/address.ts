import { keccak256, toHex, utf8 } from "./keccak.js";

// ---------------------------------------------------------------------------
// EIP-55 address validation.
//
// THE CASE RULE IS THE WHOLE THING, AND IT IS EASY TO GET BACKWARDS.
//
// Per ERC-55, an all-lowercase or all-uppercase address carries NO checksum and
// is perfectly valid — plenty of explorers, RPC responses and APIs emit
// lowercase. Only a MIXED-case address is claiming a checksum, and only then
// must it verify.
//
// Implementations that "enforce EIP-55" unconditionally reject addresses their
// users legitimately pasted, turning a safety check into an outage. Getting it
// inverted the other way — accepting any mixed case — silently discards the
// ~99.986% typo detection the standard exists to provide.
// ---------------------------------------------------------------------------

const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;

/**
 * A 20-byte hex address whose EIP-55 checksum, if it claims one, is correct.
 *
 * Accepts all-lowercase and all-uppercase (no checksum claimed). Rejects
 * mixed-case whose checksum does not verify.
 */
export function isAddress(value: unknown): value is string {
  if (typeof value !== "string" || !ADDRESS_SHAPE.test(value)) return false;

  const body = value.slice(2);
  const hasUpper = /[A-F]/.test(body);
  const hasLower = /[a-f]/.test(body);
  // No mixed case → no checksum claimed → nothing to verify.
  if (!hasUpper || !hasLower) return true;

  return body === checksumBody(body.toLowerCase());
}

/**
 * The zero address, which is a well-formed 20-byte value and never a valid
 * counterparty.
 *
 * Worth its own predicate because `isAddress` correctly accepts it: sending to
 * it burns funds, and approving it is meaningless. Callers that mean "an
 * address someone controls" want this one.
 */
export function isNonZeroAddress(value: unknown): value is string {
  return isAddress(value) && !ZERO_ADDRESS.test(value);
}

/** Rewrites an address into its EIP-55 mixed-case form. */
export function toChecksumAddress(value: string): string {
  if (!ADDRESS_SHAPE.test(value)) {
    throw new TypeError(`Not a 20-byte hex address: ${value}`);
  }
  return "0x" + checksumBody(value.slice(2).toLowerCase());
}

/** True when two addresses refer to the same account, whatever their casing. */
export function sameAddress(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!ADDRESS_SHAPE.test(a) || !ADDRESS_SHAPE.test(b)) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** EIP-55 body: uppercase a hex letter when its nibble in keccak(lower) ≥ 8. */
function checksumBody(lower: string): string {
  const hash = toHex(keccak256(utf8(lower)));
  let out = "";
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}
