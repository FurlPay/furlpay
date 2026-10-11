// BVNK sends amounts as JSON numbers (e.g. 10.5). FurlPay never does
// arithmetic on them as floats: an amount is turned into an exact decimal
// string once, at the boundary, and stored as numeric text.
//
// JSON.parse gives the double nearest the literal; String() of a double is the
// shortest decimal that round-trips to it, which for any literal of up to 15
// significant digits is the literal itself. Amounts with more significant
// digits than that, non-finite values and negatives are refused rather than
// silently rounded.

export class BvnkAmountError extends Error {}

const MAX_SIG_DIGITS = 15;

/** Exact decimal string for a provider amount ("10.5", "0.000001", "1000"). */
export function decimalString(value: unknown, field = "amount"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new BvnkAmountError(`${field} is not a finite number`);
  if (value < 0) throw new BvnkAmountError(`${field} is negative`);
  let s = String(value);
  if (/e/i.test(s)) {
    // 1e-7 style: expand without going through float arithmetic.
    const [mant, expStr] = s.toLowerCase().split("e");
    const exp = Number(expStr);
    const [i, f = ""] = mant.split(".");
    const digits = i + f;
    const point = i.length + exp;
    s = point <= 0 ? "0." + "0".repeat(-point) + digits : point >= digits.length ? digits + "0".repeat(point - digits.length) : digits.slice(0, point) + "." + digits.slice(point);
  }
  const sig = s.replace(".", "").replace(/^0+/, "");
  if (sig.length > MAX_SIG_DIGITS) throw new BvnkAmountError(`${field} has more precision than can be represented exactly`);
  return s;
}

/** Integer minor units at `decimals`, or an error if the amount is finer than that. */
export function toMinorUnits(decimal: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(decimal)) throw new BvnkAmountError("not a decimal string");
  const [i, f = ""] = decimal.split(".");
  const trimmed = f.replace(/0+$/, "");
  if (trimmed.length > decimals) throw new BvnkAmountError(`more than ${decimals} decimal places`);
  return BigInt(i + trimmed.padEnd(decimals, "0"));
}
