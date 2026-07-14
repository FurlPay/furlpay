// ---------------------------------------------------------------------------
// Authoritative money-amount parsing. Money never goes through floating point:
// a user-typed string is parsed straight to atomic units (bigint) or rejected.
// `Number(x) > 0` is NOT a money check — "0.0000001" passes it and then
// truncates to 0 atomic USDC, which would let a user biometric-sign a
// zero-value authorization.
// ---------------------------------------------------------------------------

export const USDC_DECIMALS = 6;
const ATOMIC_PER_WHOLE = 1_000_000n;

/** Cap on a single mobile send: $999,999,999. A paste error, not a use case,
 *  is the only thing above it — the server's per-transfer quote limit is the
 *  real ceiling and is far lower. */
const MAX_WHOLE_DIGITS = 9;

/** Thrown with a user-displayable message; callers show `.message` verbatim. */
export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

/**
 * Parse a user-typed USDC amount into atomic units (6dp bigint).
 *
 * Accepts exactly: optional whitespace around `digits` or `digits.1-6digits`.
 * Everything else throws AmountError with a message saying why:
 * empty, negative, scientific notation, locale separators (`1,000` / `1 000`),
 * more than 6 decimals (rejected, NOT silently truncated), zero, NaN/Infinity
 * shapes, and values above the sanity cap.
 */
export function parseUsdcAmount(input: string): bigint {
  const s = input.trim();
  if (!s) throw new AmountError("Enter an amount.");
  if (/[eE]/.test(s)) throw new AmountError("Enter a plain amount like 12.50 — scientific notation isn't supported.");
  if (/[,\s']/.test(s)) throw new AmountError("Remove separators — enter the amount like 1250.50.");
  if (s.startsWith("-")) throw new AmountError("Amount must be positive.");

  const m = s.match(/^(\d+)(?:\.(\d*))?$/);
  if (!m) throw new AmountError("Enter a valid amount like 12.50.");
  const [, whole, frac = ""] = m;

  if (frac.length > USDC_DECIMALS) {
    throw new AmountError(`USDC supports at most ${USDC_DECIMALS} decimal places.`);
  }
  if (whole.replace(/^0+(?=\d)/, "").length > MAX_WHOLE_DIGITS) {
    throw new AmountError("That amount is above the supported maximum.");
  }

  const atomic = BigInt(whole) * ATOMIC_PER_WHOLE + BigInt(frac.padEnd(USDC_DECIMALS, "0") || "0");
  if (atomic === 0n) {
    throw new AmountError(`Amount must be at least 0.000001 USDC.`);
  }
  return atomic;
}

/** Non-throwing variant for live form validation. */
export function tryParseUsdcAmount(input: string): bigint | null {
  try {
    return parseUsdcAmount(input);
  } catch {
    return null;
  }
}

/** Atomic USDC → display string ("1234567" → "1.234567"), no float drift. */
export function formatAtomicUsdc(atomic: bigint): string {
  const neg = atomic < 0n;
  const abs = neg ? -atomic : atomic;
  const whole = abs / ATOMIC_PER_WHOLE;
  const frac = (abs % ATOMIC_PER_WHOLE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
