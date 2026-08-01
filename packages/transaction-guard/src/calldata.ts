// ---------------------------------------------------------------------------
// Shape checks for the hex-encoded fields of a transaction.
//
// None of this is clever. It exists because every one of these fields arrives
// as a string from something the wallet does not control — an aggregator, a
// backend, a dApp — and a malformed one becomes a signature over nonsense.
// ---------------------------------------------------------------------------

/**
 * `0x` followed by an EVEN number of hex digits.
 *
 * The evenness matters: calldata is bytes, and an odd-length string is not a
 * byte sequence. Implementations that pad it silently change the selector.
 * `"0x"` itself is valid here — it is empty calldata, which is meaningful for a
 * plain value transfer. Callers that require a contract call should use
 * `hasCalldata`.
 */
export function isHexData(value: unknown): value is string {
  return typeof value === "string" && /^0x([0-9a-fA-F]{2})*$/.test(value);
}

/** Non-empty calldata — a contract call rather than a bare transfer. */
export function hasCalldata(value: unknown): value is string {
  return isHexData(value) && value.length > 2;
}

/**
 * A JSON-RPC QUANTITY: `0x` followed by at least one hex digit.
 *
 * Distinct from `isHexData` because a quantity has no evenness requirement —
 * `0x1` is a valid quantity and an invalid byte string.
 */
export function isQuantity(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

/**
 * The 4-byte function selector from calldata, or null.
 *
 * Useful for checking a route calls the function you expect rather than an
 * arbitrary one on the same contract.
 */
export function selectorOf(calldata: unknown): string | null {
  if (!hasCalldata(calldata) || calldata.length < 10) return null;
  return calldata.slice(0, 10).toLowerCase();
}

/**
 * A decimal atomic amount as a bigint, or null.
 *
 * NEVER THROWS, which is the point. `BigInt("abc")` throws, and an exception
 * escaping a validator is an unhandled crash rather than a rejection the caller
 * can render. The regex covers the common cases; the try/catch covers the rest.
 *
 * Values at or above 2^256 are rejected: no ERC-20 balance can hold one and no
 * `approve()` can encode it, so such a value is malformed by definition.
 */
export function parseAtomic(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value >= 0n && value < 1n << 256n ? value : null;
  }
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    return parsed < 1n << 256n ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A hex QUANTITY as a bigint, or null. Same no-throw contract as `parseAtomic`.
 *
 * Deliberately not `Number()`: gas limits and wei values routinely exceed
 * 2^53, where Number silently rounds — and a rounded `value` moves a different
 * amount than the one quoted.
 */
export function parseQuantity(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (!isQuantity(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
