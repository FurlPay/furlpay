// ---------------------------------------------------------------------------
// FURL amount conversion. Integer-only, both directions.
//
// FURL has SIX decimals. The failure this module exists to make impossible is
// the one that has already appeared twice in FurlPay planning documents:
// treating the token as 9-decimal (`10_000_000 * 1e9`), which silently produces
// an amount 1,000× too large — in that case ten billion FURL, ten times the
// entire supply.
//
// THREE RULES, ENFORCED RATHER THAN DOCUMENTED:
//
//  1. A token amount NEVER passes through a JavaScript number. Amounts arrive
//     and leave as decimal STRINGS and are held as bigint. At 6 decimals the
//     base-unit value of ~9,007 FURL already exceeds Number.MAX_SAFE_INTEGER,
//     so float arithmetic starts losing value inside ordinary balances, not
//     exotic ones.
//
//  2. The decimal scale is NEVER a parameter with a default. `FURL_DECIMALS` is
//     a constant checked against the on-chain mint by the audit script. A
//     function that accepts `decimals = 9` is a function that will eventually be
//     called with 9.
//
//  3. Excess precision is REJECTED, never truncated. Silently dropping the 7th
//     decimal place turns "send 0.0000005" into "send 0", which looks like a
//     successful payment that moved nothing.
// ---------------------------------------------------------------------------

/** FURL's on-chain scale. Verified against the mint by scripts/audit-mainnet.ts. */
export const FURL_DECIMALS = 6 as const;

/** 10^6, as a bigint. The only scaling factor this module will ever apply. */
const SCALE = 10n ** BigInt(FURL_DECIMALS);

/** u64 ceiling — every SPL token amount is a u64 on chain. */
export const U64_MAX = 18_446_744_073_709_551_615n;

/** Total FURL supply in base units, for sanity-bounding any single amount. */
export const FURL_TOTAL_SUPPLY_BASE_UNITS = 1_000_000_000_000_000n;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

/**
 * Human-readable FURL → raw base units.
 *
 * Accepts a decimal string ("12.5", "0.000001", "1000"). Deliberately does NOT
 * accept a number: by the time a float reaches this function the damage may
 * already be done, and accepting one would make rule 1 unenforceable.
 */
export function furlToBaseUnits(amount: string): bigint {
  if (typeof amount !== "string") {
    throw new AmountError(
      "FURL amounts must be strings, not numbers — a float cannot represent every 6-decimal amount exactly.",
    );
  }

  const trimmed = amount.trim();
  if (trimmed === "") throw new AmountError("Amount is empty.");

  // No exponent notation, no sign, no separators. "1e6" is 1,000,000 to a
  // parser and a typo to a human; both readings are a reason to refuse.
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new AmountError(
      `"${amount}" is not a plain decimal amount. Use digits and at most one "." (no signs, exponents, commas, or spaces).`,
    );
  }

  const [intPart, fracPart = ""] = trimmed.split(".");

  if (fracPart.length > FURL_DECIMALS) {
    throw new AmountError(
      `"${amount}" has ${fracPart.length} decimal places but FURL has ${FURL_DECIMALS}. ` +
        `Rounding here would change the amount sent, so it is refused instead.`,
    );
  }

  // Pad — never multiply a float. "12.5" → int 12, frac "500000".
  const padded = fracPart.padEnd(FURL_DECIMALS, "0");
  const base = BigInt(intPart) * SCALE + BigInt(padded === "" ? "0" : padded);

  if (base > U64_MAX) {
    throw new AmountError(`Amount ${amount} exceeds the u64 maximum for an SPL transfer.`);
  }
  return base;
}

/**
 * Raw base units → human-readable FURL string.
 *
 * Accepts bigint or a digit string (what an RPC returns). Never returns a
 * number, so a caller cannot accidentally reintroduce float error downstream.
 */
export function baseUnitsToFurl(base: bigint | string): string {
  let raw: bigint;
  if (typeof base === "bigint") {
    raw = base;
  } else {
    if (!/^\d+$/.test(base.trim())) {
      throw new AmountError(`"${base}" is not a base-unit integer string.`);
    }
    raw = BigInt(base.trim());
  }
  if (raw < 0n) throw new AmountError("Base units cannot be negative.");

  const whole = raw / SCALE;
  const frac = raw % SCALE;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(FURL_DECIMALS, "0").replace(/0+$/, "")}`;
}

/** Display formatting with thousands separators. Presentation only. */
export function formatFurlAmount(base: bigint | string, maxFractionDigits = 6): string {
  const s = baseUnitsToFurl(base);
  const [whole, frac = ""] = s.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = frac.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

export type SufficiencyResult =
  | { ok: true }
  | { ok: false; reason: "insufficient" | "not_positive" | "exceeds_supply"; detail: string };

/**
 * Can `balanceBaseUnits` cover `amountBaseUnits`?
 *
 * bigint comparison only. A float comparison would start approving transfers a
 * balance cannot cover somewhere in the thousands of FURL.
 */
export function checkSufficientBalance(
  balanceBaseUnits: bigint,
  amountBaseUnits: bigint,
): SufficiencyResult {
  if (amountBaseUnits <= 0n) {
    return { ok: false, reason: "not_positive", detail: "Amount must be greater than zero." };
  }
  // A single transfer larger than the entire supply is a unit-conversion bug,
  // not a user intent. Catching it here names the cause instead of letting the
  // chain reject an opaque instruction.
  if (amountBaseUnits > FURL_TOTAL_SUPPLY_BASE_UNITS) {
    return {
      ok: false,
      reason: "exceeds_supply",
      detail:
        `Amount ${baseUnitsToFurl(amountBaseUnits)} FURL exceeds the entire 1,000,000,000 FURL supply. ` +
        `This is almost always a decimals mistake (treating FURL as 9-decimal instead of ${FURL_DECIMALS}).`,
    };
  }
  if (balanceBaseUnits < amountBaseUnits) {
    return {
      ok: false,
      reason: "insufficient",
      detail: `Balance ${baseUnitsToFurl(balanceBaseUnits)} FURL is less than ${baseUnitsToFurl(amountBaseUnits)} FURL.`,
    };
  }
  return { ok: true };
}
