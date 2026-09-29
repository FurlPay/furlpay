// ---------------------------------------------------------------------------
// Money, as integers.
//
// Every limit in this package is compared as a bigint parsed from a decimal
// string. No float ever touches an authorization boundary, for the reason
// @furlpay/x402-guard's policy.ts already records:
//
//     0.1 + 0.2 > 0.3   -> true
//
// A user with a $0.30 cap who has spent $0.10 is refused a legitimate $0.20,
// and two parties summing the same spend in different orders reach different
// totals and disagree about how much budget is left. Both failures are silent.
//
// THE UNIT IS PER-ASSET AND IS NOT INTERCHANGEABLE. USDC has 6 decimals, most
// ERC-20s have 18, USD has 2. A comparison between two amounts carries an
// implicit claim that they are denominated the same way, so `Atomic` values are
// only ever compared after the policy engine has established that the asset and
// network match. That check lives in policy.ts and is not optional.
// ---------------------------------------------------------------------------

/** Integer minor units as a decimal string. "1500000" = 1.5 USDC (6dp). */
export type Atomic = string;

const DECIMAL = /^-?[0-9]+$/;

export class AtomicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtomicError";
  }
}

/** Parse an atomic string, or null when it is not an integer literal. */
export function parseAtomic(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!DECIMAL.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

/** Parse or throw. Use where a malformed amount is a programming error. */
export function mustParseAtomic(value: unknown, field: string): bigint {
  const parsed = parseAtomic(value);
  if (parsed === null) throw new AtomicError(`${field} is not an integer amount: ${String(value)}`);
  return parsed;
}

/**
 * Convert a decimal major-unit string to atomic units, exactly.
 *
 * STRING IN, STRING OUT, ON PURPOSE. Accepting a `number` here would put a
 * float on the path into the integer domain and re-introduce exactly what this
 * module exists to keep out: `28.50 * 1e6` is 28499999.999999996 on some
 * inputs. The conversion is done by moving the decimal point textually.
 *
 * Rejects more fractional digits than the asset can represent rather than
 * rounding: silently dropping a digit changes the amount a human authorized.
 */
export function majorToAtomic(major: string, decimals: number): Atomic {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new AtomicError(`Unsupported decimals: ${decimals}`);
  }
  const text = String(major).trim();
  const match = /^(-?)([0-9]*)(?:\.([0-9]*))?$/.exec(text);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) {
    throw new AtomicError(`Not a decimal amount: ${major}`);
  }
  const [, sign, whole, fractionRaw] = match;
  const fraction = fractionRaw ?? "";
  if (fraction.length > decimals) {
    throw new AtomicError(
      `${major} has ${fraction.length} fractional digits but the asset carries ${decimals}. ` +
        `Rounding here would change the authorized amount, so it is refused.`
    );
  }
  const padded = fraction.padEnd(decimals, "0");
  const digits = `${whole === "" ? "0" : whole}${padded}`.replace(/^0+(?=[0-9])/, "");
  return `${sign}${digits === "" ? "0" : digits}`;
}

/** Render atomic units as a decimal string. Display only — never re-parsed. */
export function atomicToMajor(atomic: Atomic, decimals: number): string {
  const value = mustParseAtomic(atomic, "atomic");
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? "" : `.${digits.slice(digits.length - decimals)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Sum a list of atomic amounts. Empty list is "0", not an error. */
export function sumAtomic(values: readonly Atomic[]): Atomic {
  let total = 0n;
  for (const v of values) total += mustParseAtomic(v, "amount");
  return total.toString();
}

export function maxAtomic(a: Atomic, b: Atomic): Atomic {
  return mustParseAtomic(a, "a") >= mustParseAtomic(b, "b") ? a : b;
}

/** Decimals for the assets the control plane prices in. */
export const ASSET_DECIMALS: Readonly<Record<string, number>> = {
  USDC: 6,
  USDT: 6,
  EURC: 6,
  PYUSD: 6,
  USAT: 6,
  DAI: 18,
  ETH: 18,
  SOL: 9,
  USD: 2,
  EUR: 2,
  INR: 2,
  SGD: 2,
  GBP: 2,
};

/**
 * Decimals for an asset symbol, or null when unknown.
 *
 * NULL IS A REFUSAL, NOT A DEFAULT. Guessing 6 for an unrecognised symbol is
 * how a caller ends up authorizing 10^12 units of an 18-decimal token against a
 * cap denominated in 10^6 — the numbers compare cleanly and the payment is a
 * million times the intended size. Callers must reject the unknown asset.
 */
export function decimalsFor(asset: string): number | null {
  const found = ASSET_DECIMALS[asset.trim().toUpperCase()];
  return found === undefined ? null : found;
}
