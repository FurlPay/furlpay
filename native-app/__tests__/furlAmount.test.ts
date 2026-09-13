import {
  furlToBaseUnits,
  baseUnitsToFurl,
  formatFurlAmount,
  checkSufficientBalance,
  AmountError,
  FURL_DECIMALS,
  FURL_TOTAL_SUPPLY_BASE_UNITS,
  U64_MAX,
} from "../lib/solana/amount";

// ---------------------------------------------------------------------------
// FURL decimal conversion.
//
// The specific disaster under test: FURL has 6 decimals, and FurlPay planning
// documents have twice written `10_000_000 * 1e9` — treating it as 9-decimal.
// That is not a rounding error. It is 1,000× too large: ten billion FURL, ten
// times the entire supply, from an expression that looks perfectly ordinary.
//
// These tests assert that the 1,000× and 1,000,000× forms are UNREACHABLE
// through this module's API, not merely undocumented.
// ---------------------------------------------------------------------------

describe("the 1,000× / 1,000,000× decimals disaster is unreachable", () => {
  it("10,000,000 FURL is 1e13 base units — NOT the 1e16 that 9 decimals would give", () => {
    const correct = furlToBaseUnits("10000000");
    expect(correct).toBe(10_000_000_000_000n); // 10M × 10^6

    const nineDecimalMistake = 10_000_000n * 10n ** 9n; // what the docs wrote
    expect(correct).not.toBe(nineDecimalMistake);
    expect(nineDecimalMistake / correct).toBe(1000n); // exactly 1,000× too big
  });

  it("the 9-decimal amount would exceed the total supply, and is refused", () => {
    const nineDecimalMistake = 10_000_000n * 10n ** 9n;
    expect(nineDecimalMistake).toBeGreaterThan(FURL_TOTAL_SUPPLY_BASE_UNITS);

    const check = checkSufficientBalance(FURL_TOTAL_SUPPLY_BASE_UNITS, nineDecimalMistake);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe("exceeds_supply");
    expect(check.detail).toMatch(/decimals mistake/i);
  });

  it("REFUSES a number, so `10_000_000 * 1e9` cannot be passed in at all", () => {
    // The literal shape of the bug: a pre-multiplied float.
    expect(() => furlToBaseUnits(10_000_000 * 1e9 as unknown as string)).toThrow(AmountError);
    expect(() => furlToBaseUnits(10_000_000 as unknown as string)).toThrow(/must be strings/);
    expect(() => furlToBaseUnits(1.5 as unknown as string)).toThrow(/must be strings/);
  });

  it("refuses exponent notation, which is how 1e9 sneaks in as a string", () => {
    for (const bad of ["1e6", "1e9", "1E6", "10000000e9", "1.5e3"]) {
      expect(() => furlToBaseUnits(bad)).toThrow(AmountError);
    }
  });

  it("scaling is exactly 10^6 at every magnitude — never 10^9", () => {
    const cases: [string, bigint][] = [
      ["1", 1_000_000n],
      ["10", 10_000_000n],
      ["1000", 1_000_000_000n],
      ["1000000", 1_000_000_000_000n],
      ["1000000000", 1_000_000_000_000_000n], // the whole supply
    ];
    for (const [input, expected] of cases) {
      const got = furlToBaseUnits(input);
      expect(got).toBe(expected);
      // Explicitly: the ratio to the human amount is 10^6, not 10^9.
      expect(got / BigInt(input)).toBe(10n ** BigInt(FURL_DECIMALS));
    }
  });

  it("the whole supply converts to exactly 1e15 base units", () => {
    expect(furlToBaseUnits("1000000000")).toBe(FURL_TOTAL_SUPPLY_BASE_UNITS);
    expect(baseUnitsToFurl(FURL_TOTAL_SUPPLY_BASE_UNITS)).toBe("1000000000");
  });
});

describe("furlToBaseUnits", () => {
  it("converts whole and fractional amounts exactly", () => {
    expect(furlToBaseUnits("0")).toBe(0n);
    expect(furlToBaseUnits("1")).toBe(1_000_000n);
    expect(furlToBaseUnits("12.5")).toBe(12_500_000n);
    expect(furlToBaseUnits("0.000001")).toBe(1n); // one base unit
    expect(furlToBaseUnits("0.1")).toBe(100_000n);
    expect(furlToBaseUnits("123456.654321")).toBe(123_456_654_321n);
  });

  it("is exact on values a float would mangle", () => {
    // 0.1 + 0.2 !== 0.3 in float; these must be exact.
    expect(furlToBaseUnits("0.1") + furlToBaseUnits("0.2")).toBe(furlToBaseUnits("0.3"));
    expect(furlToBaseUnits("29.97")).toBe(29_970_000n);
    expect(furlToBaseUnits("0.07")).toBe(70_000n);
  });

  it("REJECTS excess precision instead of truncating it", () => {
    // Truncation would turn a real payment into a zero-value one.
    expect(() => furlToBaseUnits("0.0000001")).toThrow(/decimal places/);
    expect(() => furlToBaseUnits("1.1234567")).toThrow(/decimal places/);
    expect(() => furlToBaseUnits("1.000000000")).toThrow(/decimal places/);
  });

  it("rejects malformed input rather than coercing it", () => {
    for (const bad of ["", "  ", "abc", "-1", "+1", "1.2.3", "1,000", "1 000", ".5", "5.", "0x10", "NaN", "Infinity"]) {
      expect(() => furlToBaseUnits(bad)).toThrow(AmountError);
    }
  });

  it("accepts surrounding whitespace but nothing else", () => {
    expect(furlToBaseUnits("  12.5  ")).toBe(12_500_000n);
  });

  it("refuses an amount above u64", () => {
    const tooBig = (U64_MAX / 10n ** 6n + 1n).toString();
    expect(() => furlToBaseUnits(tooBig)).toThrow(/u64/);
  });
});

describe("baseUnitsToFurl", () => {
  it("round-trips every amount without drift", () => {
    for (const amount of ["0", "1", "0.000001", "12.5", "999999999.999999", "1000000000"]) {
      expect(baseUnitsToFurl(furlToBaseUnits(amount))).toBe(amount);
    }
  });

  it("accepts the digit strings an RPC returns", () => {
    expect(baseUnitsToFurl("1000000000000000")).toBe("1000000000");
    expect(baseUnitsToFurl("1")).toBe("0.000001");
    expect(baseUnitsToFurl(0n)).toBe("0");
  });

  it("stays exact past Number.MAX_SAFE_INTEGER", () => {
    // 9,007,199,254.740993 FURL — a float round-trip loses the last digit.
    expect(baseUnitsToFurl("9007199254740993")).toBe("9007199254.740993");

    // Proof that the float path loses it. Comparing `Number(x)` to the numeric
    // LITERAL would prove nothing: the literal rounds to the same value, so both
    // sides are 9007199254740992 and the assertion passes vacuously. Compare the
    // rendered digits instead.
    expect(String(Number("9007199254740993"))).toBe("9007199254740992");
    expect(BigInt("9007199254740993").toString()).toBe("9007199254740993");
  });

  it("rejects negative and malformed base units", () => {
    expect(() => baseUnitsToFurl(-1n)).toThrow(AmountError);
    expect(() => baseUnitsToFurl("1.5")).toThrow(AmountError);
    expect(() => baseUnitsToFurl("abc")).toThrow(AmountError);
  });
});

describe("formatFurlAmount", () => {
  it("groups thousands and trims trailing zeros", () => {
    expect(formatFurlAmount(FURL_TOTAL_SUPPLY_BASE_UNITS)).toBe("1,000,000,000");
    expect(formatFurlAmount(12_500_000n)).toBe("12.5");
    expect(formatFurlAmount(1_000_500n)).toBe("1.0005");
    expect(formatFurlAmount(0n)).toBe("0");
  });

  it("caps fraction digits without altering the underlying value", () => {
    expect(formatFurlAmount(1_123_456n, 2)).toBe("1.12");
    expect(formatFurlAmount(1_123_456n, 6)).toBe("1.123456");
  });
});

describe("checkSufficientBalance", () => {
  it("passes when the balance covers the amount exactly", () => {
    expect(checkSufficientBalance(12_500_000n, 12_500_000n)).toEqual({ ok: true });
  });

  it("fails one base unit short", () => {
    const r = checkSufficientBalance(12_499_999n, 12_500_000n);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("insufficient");
  });

  it("rejects zero and negative amounts", () => {
    for (const bad of [0n, -1n]) {
      const r = checkSufficientBalance(1_000_000n, bad);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("not_positive");
    }
  });

  it("stays exact above Number.MAX_SAFE_INTEGER", () => {
    // As floats these two are equal; as bigints they are not.
    const balance = 9_007_199_254_740_992n;
    const amount = 9_007_199_254_740_993n;
    expect(Number(balance)).toBe(Number(amount)); // the float trap
    expect(checkSufficientBalance(balance, amount).ok).toBe(false); // bigint catches it
  });
});
