import { AmountError, formatAtomicUsdc, parseUsdcAmount, tryParseUsdcAmount } from "../money";

// The invariant under test: no send may proceed unless amountAtomic > 0n, and
// money strings never pass through floating point on the way there.
describe("parseUsdcAmount", () => {
  it("parses plain amounts to atomic units", () => {
    expect(parseUsdcAmount("1")).toBe(1_000_000n);
    expect(parseUsdcAmount("12.50")).toBe(12_500_000n);
    expect(parseUsdcAmount("0.000001")).toBe(1n);
    expect(parseUsdcAmount(" 250 ")).toBe(250_000_000n); // surrounding whitespace ok
    expect(parseUsdcAmount("999999999")).toBe(999_999_999_000_000n); // max whole
    expect(parseUsdcAmount("0007.10")).toBe(7_100_000n); // leading zeros ok
  });

  it("rejects zero-atomic amounts that float-pass `Number(x) > 0` (BUG 3)", () => {
    // Number("0.0000001") > 0 is true — but it truncates to 0 atomic units.
    expect(Number("0.0000001") > 0).toBe(true);
    expect(() => parseUsdcAmount("0.0000001")).toThrow(AmountError);
  });

  it("rejects zero", () => {
    expect(() => parseUsdcAmount("0")).toThrow(AmountError);
    expect(() => parseUsdcAmount("0.0")).toThrow(AmountError);
    expect(() => parseUsdcAmount("0.000000")).toThrow(AmountError);
  });

  it("rejects negatives", () => {
    expect(() => parseUsdcAmount("-1")).toThrow(AmountError);
    expect(() => parseUsdcAmount("-0.5")).toThrow(AmountError);
  });

  it("rejects excess decimal precision instead of silently truncating", () => {
    expect(() => parseUsdcAmount("1.0000001")).toThrow(/6 decimal/);
    expect(() => parseUsdcAmount("0.1234567")).toThrow(/6 decimal/);
  });

  it("rejects scientific notation", () => {
    expect(() => parseUsdcAmount("1e3")).toThrow(/scientific/i);
    expect(() => parseUsdcAmount("1E-7")).toThrow(/scientific/i);
  });

  it("rejects NaN/Infinity shapes and garbage", () => {
    for (const bad of ["NaN", "Infinity", "-Infinity", "abc", "12.34.56", ".", "0x10", "1.2f"]) {
      expect(() => parseUsdcAmount(bad)).toThrow(AmountError);
    }
  });

  it("rejects empty and whitespace-only", () => {
    expect(() => parseUsdcAmount("")).toThrow(/enter an amount/i);
    expect(() => parseUsdcAmount("   ")).toThrow(AmountError);
  });

  it("rejects locale separators", () => {
    expect(() => parseUsdcAmount("1,000")).toThrow(/separators/i);
    expect(() => parseUsdcAmount("1 000")).toThrow(/separators/i);
  });

  it("rejects amounts above the sanity cap without overflow", () => {
    expect(() => parseUsdcAmount("1000000000")).toThrow(/maximum/i); // 10 digits
    expect(() => parseUsdcAmount("999999999999999999999999")).toThrow(/maximum/i);
  });

  it("bare decimal point and trailing dot are rejected", () => {
    expect(() => parseUsdcAmount(".5")).toThrow(AmountError);
    // "1." parses as whole=1, empty frac — accept? The regex allows "1." with
    // empty frac group; it must still equal exactly 1 USDC.
    expect(parseUsdcAmount("1.")).toBe(1_000_000n);
  });
});

describe("tryParseUsdcAmount", () => {
  it("returns null instead of throwing", () => {
    expect(tryParseUsdcAmount("0.0000001")).toBeNull();
    expect(tryParseUsdcAmount("nope")).toBeNull();
    expect(tryParseUsdcAmount("5")).toBe(5_000_000n);
  });
});

describe("formatAtomicUsdc", () => {
  it("round-trips without float drift", () => {
    expect(formatAtomicUsdc(parseUsdcAmount("12.345678"))).toBe("12.345678");
    expect(formatAtomicUsdc(1n)).toBe("0.000001");
    expect(formatAtomicUsdc(1_000_000n)).toBe("1");
  });
});
