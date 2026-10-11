import { describe, expect, it } from "vitest";
import { usdcAtomic } from "@/lib/services/cctpExecution";

// ARC-P6-002: the CCTP burn amount is converted exactly, never by float multiplication + rounding.
describe("usdcAtomic", () => {
  it("converts exact decimal amounts", () => {
    expect(usdcAtomic(1)).toBe(1_000_000n);
    expect(usdcAtomic(0.1)).toBe(100_000n);          // 0.1 * 1e6 is 100000.00000000001 in floats
    expect(usdcAtomic(1.000001)).toBe(1_000_001n);
    expect(usdcAtomic(123456.789012)).toBe(123_456_789_012n);
    expect(usdcAtomic(1_000_000)).toBe(1_000_000_000_000n);
  });
  it("refuses sub-micro-USDC amounts instead of rounding them into the signed burn", () => {
    expect(() => usdcAtomic(1.0000005)).toThrow("more than 6 decimal places");
    expect(() => usdcAtomic(1e-7)).toThrow("invalid amount"); // exponent form
  });
  it("refuses non-positive and non-finite amounts", () => {
    for (const v of [0, -1, NaN, Infinity]) expect(() => usdcAtomic(v)).toThrow("invalid amount");
  });
});
