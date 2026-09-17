// ---------------------------------------------------------------------------
// Money.
//
// A `number` is not money. JavaScript's number is a float64, and a float64
// cannot represent 0.1 — so `0.1 + 0.2 !== 0.3`, and a system that adds a few
// million of those disagrees with the bank by an amount nobody can explain.
// This module makes the wrong thing unrepresentable: an amount is an integer
// count of MINOR UNITS plus the asset it counts, and the two travel together.
//
// WHY MINOR UNITS AND NOT A DECIMAL LIBRARY. Because the boundary that matters
// is the one where money enters and leaves: Postgres BIGINT, a bank's paise, a
// token's atomic units. All three are integers. Introducing a decimal type in
// the middle means two conversions instead of zero, and every conversion is a
// place a rounding rule can be chosen wrongly.
//
// WHY `bigint` AND NOT `number`. USDC has 6 decimals, but ETH has 18 and a
// wei-denominated amount overflows Number.MAX_SAFE_INTEGER at about 9 ETH.
// Anything that touches an 18-decimal asset must be exact, and a type that is
// exact only for small values is a bug with a delay on it.
//
// ASSET, NOT CURRENCY. "USD" and "USDC on Arbitrum" are different things that
// happen to be worth about the same, and confusing them is how a system
// credits a customer for a deposit that never arrived on the chain they
// actually used. An Asset carries its settlement domain.
// ---------------------------------------------------------------------------

export type AssetKind = "fiat" | "stablecoin" | "crypto";

export interface Asset {
  /** Stable identifier: "INR", "USD", "USDC.arbitrum", "ETH.ethereum". */
  readonly id: string;
  readonly kind: AssetKind;
  /** ISO-4217 for fiat; the token symbol otherwise. */
  readonly symbol: string;
  /** How many minor units make one major unit. INR=2, USDC=6, ETH=18. */
  readonly decimals: number;
  /**
   * Settlement domain. Null for fiat — a rupee is a rupee — and the chain id
   * for anything on-chain, because USDC on Arbitrum cannot pay a Base invoice
   * and a system that treats them as one asset will eventually try.
   */
  readonly chain: string | null;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** An exact amount of one asset. Immutable; every operation returns a new one. */
export class Money {
  readonly minor: bigint;
  readonly asset: Asset;

  private constructor(minor: bigint, asset: Asset) {
    this.minor = minor;
    this.asset = asset;
  }

  /** From an exact integer count of minor units — the only lossless entry. */
  static ofMinor(minor: bigint | number | string, asset: Asset): Money {
    let value: bigint;
    try {
      value = typeof minor === "bigint" ? minor : BigInt(minor);
    } catch {
      throw new MoneyError(`Not an integer minor amount: ${String(minor)}`);
    }
    return new Money(value, asset);
  }

  /**
   * From a decimal STRING ("125.50"). Deliberately not from a number: by the
   * time a float reaches this function the precision is already gone, and
   * accepting one would hide that at the only point where it is still visible.
   */
  static parse(decimal: string, asset: Asset): Money {
    const trimmed = decimal.trim();
    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
    if (!match) throw new MoneyError(`Not a decimal amount: "${decimal}"`);
    const [, sign, whole, frac = ""] = match;

    // A fraction longer than the asset allows is REJECTED, never rounded.
    // Silently dropping a digit is how a payout becomes a rounding donation,
    // and the caller is the only one who knows whether truncating is correct.
    if (frac.length > asset.decimals) {
      throw new MoneyError(
        `"${decimal}" has ${frac.length} decimal places; ${asset.symbol} allows ${asset.decimals}. ` +
          "Round explicitly before constructing Money."
      );
    }
    const padded = frac.padEnd(asset.decimals, "0");
    const minor = BigInt(`${whole}${padded}`);
    return new Money(sign === "-" ? -minor : minor, asset);
  }

  static zero(asset: Asset): Money {
    return new Money(0n, asset);
  }

  private sameAsset(other: Money, op: string): void {
    if (other.asset.id !== this.asset.id) {
      // Not a type error a compiler can catch — both are Money — so it is
      // checked here. Adding INR to USDC is meaningless and the only safe
      // answer is to refuse rather than pick one side's asset.
      throw new MoneyError(`Cannot ${op} ${other.asset.id} and ${this.asset.id}`);
    }
  }

  plus(other: Money): Money {
    this.sameAsset(other, "add");
    return new Money(this.minor + other.minor, this.asset);
  }

  minus(other: Money): Money {
    this.sameAsset(other, "subtract");
    return new Money(this.minor - other.minor, this.asset);
  }

  /**
   * Multiply by a rational (numerator/denominator) with an explicit rounding
   * mode. Fees and FX are rationals, not floats — 0.5% is 1/200, and expressing
   * it as 0.005 reintroduces exactly the error this class exists to remove.
   *
   * `mode` has no default on purpose. Whether a fee rounds toward the customer
   * or the platform is a business decision, and a default would make it
   * silently.
   */
  scale(
    numerator: bigint,
    denominator: bigint,
    mode: "floor" | "ceil" | "half-up"
  ): Money {
    if (denominator === 0n) throw new MoneyError("Division by zero in scale()");
    const negative = this.minor < 0n !== denominator < 0n;
    const n = this.minor < 0n ? -this.minor : this.minor;
    const num = numerator < 0n ? -numerator : numerator;
    const den = denominator < 0n ? -denominator : denominator;

    const product = n * num;
    const quotient = product / den;
    const remainder = product % den;

    let magnitude = quotient;
    if (remainder !== 0n) {
      if (mode === "ceil") magnitude = quotient + 1n;
      else if (mode === "half-up" && remainder * 2n >= den) magnitude = quotient + 1n;
      // "floor" keeps the truncated quotient.
    }
    return new Money(negative ? -magnitude : magnitude, this.asset);
  }

  /**
   * Split into `parts` as evenly as possible, distributing the remainder one
   * minor unit at a time.
   *
   * The invariant is that the parts sum EXACTLY to the original. Splitting
   * ₹10.00 three ways by dividing and rounding loses a paisa, and a system that
   * loses a paisa per split cannot reconcile.
   */
  allocate(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new MoneyError(`allocate() needs a positive integer, got ${parts}`);
    }
    const n = BigInt(parts);
    const base = this.minor / n;
    let remainder = this.minor - base * n;
    const step = this.minor < 0n ? -1n : 1n;
    const out: Money[] = [];
    for (let i = 0; i < parts; i++) {
      let share = base;
      if (remainder !== 0n) {
        share += step;
        remainder -= step;
      }
      out.push(new Money(share, this.asset));
    }
    return out;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }
  isNegative(): boolean {
    return this.minor < 0n;
  }
  isPositive(): boolean {
    return this.minor > 0n;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.sameAsset(other, "compare");
    if (this.minor < other.minor) return -1;
    if (this.minor > other.minor) return 1;
    return 0;
  }

  /** Exact decimal string. Never a float, so it round-trips through parse(). */
  toDecimalString(): string {
    const negative = this.minor < 0n;
    const digits = (negative ? -this.minor : this.minor).toString().padStart(this.asset.decimals + 1, "0");
    const cut = digits.length - this.asset.decimals;
    const whole = digits.slice(0, cut);
    const frac = digits.slice(cut);
    const body = this.asset.decimals === 0 ? whole : `${whole}.${frac}`;
    return negative ? `-${body}` : body;
  }

  /** Wire form. `minor` is a STRING because JSON has no bigint and JSON.parse
   *  would silently degrade an 18-decimal amount to a float. */
  toJSON(): { minor: string; asset: string; decimals: number; display: string } {
    return {
      minor: this.minor.toString(),
      asset: this.asset.id,
      decimals: this.asset.decimals,
      display: this.toDecimalString(),
    };
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.asset.symbol}`;
  }
}

// ── The asset registry ─────────────────────────────────────────────────────
//
// Deliberately small, and deliberately explicit about chain. A new asset is
// added HERE, once, rather than as a string literal at a call site — a typo'd
// asset id at a call site is a silently different asset.

export const ASSETS = {
  INR: { id: "INR", kind: "fiat", symbol: "INR", decimals: 2, chain: null },
  USD: { id: "USD", kind: "fiat", symbol: "USD", decimals: 2, chain: null },
  EUR: { id: "EUR", kind: "fiat", symbol: "EUR", decimals: 2, chain: null },
  GBP: { id: "GBP", kind: "fiat", symbol: "GBP", decimals: 2, chain: null },

  "USDC.ethereum": { id: "USDC.ethereum", kind: "stablecoin", symbol: "USDC", decimals: 6, chain: "ethereum" },
  "USDC.arbitrum": { id: "USDC.arbitrum", kind: "stablecoin", symbol: "USDC", decimals: 6, chain: "arbitrum" },
  "USDC.base": { id: "USDC.base", kind: "stablecoin", symbol: "USDC", decimals: 6, chain: "base" },
  "USDC.polygon": { id: "USDC.polygon", kind: "stablecoin", symbol: "USDC", decimals: 6, chain: "polygon" },

  // Circle Arc. 18 decimals, and NOT a typo.
  //
  // On Arc, USDC is the native gas asset. One balance is exposed through two
  // interfaces: native at 18 decimals (canonical) and ERC-20 at 6 decimals (a
  // truncating view of the same money). Verified on mainnet 2026-09-17: an
  // account's eth_getBalance was 57628035984085784575 while balanceOf returned
  // 57628035 — the same holding, with 984085784575 of dust invisible to the
  // ERC-20 side.
  //
  // So there is exactly ONE asset here, carried at the canonical precision.
  // Registering a second "USDC.arc.erc20" would double-count every Arc balance
  // and is what Circle's docs mean by "do not model native USDC and ERC-20
  // USDC as separate holdings". Convert at the interface boundary instead —
  // lib/chains/arc.ts owns that conversion and nothing else should do it
  // inline.
  "USDC.arc": { id: "USDC.arc", kind: "stablecoin", symbol: "USDC", decimals: 18, chain: "arc" },

  "ETH.ethereum": { id: "ETH.ethereum", kind: "crypto", symbol: "ETH", decimals: 18, chain: "ethereum" },
  "ETH.arbitrum": { id: "ETH.arbitrum", kind: "crypto", symbol: "ETH", decimals: 18, chain: "arbitrum" },
  "ETH.base": { id: "ETH.base", kind: "crypto", symbol: "ETH", decimals: 18, chain: "base" },
} as const satisfies Record<string, Asset>;

export type AssetId = keyof typeof ASSETS;

export function assetById(id: string): Asset | undefined {
  return (ASSETS as Record<string, Asset>)[id];
}

/** Resolve or throw. Use where an unknown asset is a bug, not user input. */
export function requireAsset(id: string): Asset {
  const asset = assetById(id);
  if (!asset) throw new MoneyError(`Unknown asset: "${id}"`);
  return asset;
}
