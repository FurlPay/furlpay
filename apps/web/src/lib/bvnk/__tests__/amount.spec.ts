import { describe, expect, it } from "vitest";
import { BvnkAmountError, decimalString, toMinorUnits } from "../amount";

describe("provider amounts are exact decimals", () => {
  it("keeps the literal BVNK sent", () => {
    expect(decimalString(10.5)).toBe("10.5");
    expect(decimalString(9.52)).toBe("9.52");
    expect(decimalString(0.1)).toBe("0.1");
    expect(decimalString(1000)).toBe("1000");
    expect(decimalString(0.000001)).toBe("0.000001");
    expect(decimalString(1e-7)).toBe("0.0000001");
    expect(decimalString(123456789.123456)).toBe("123456789.123456");
  });

  it("refuses negative, non-finite, non-numeric and over-precise values instead of rounding", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, "10.5", null, 0.1 + 0.2]) {
      expect(() => decimalString(bad as number), String(bad)).toThrow(BvnkAmountError);
    }
  });

  it("converts to minor units exactly, refusing extra precision", () => {
    expect(toMinorUnits("10.5", 2)).toBe(1050n);
    expect(toMinorUnits("9.520", 2)).toBe(952n);
    expect(toMinorUnits("0.000001", 6)).toBe(1n);
    expect(() => toMinorUnits("0.001", 2)).toThrow(BvnkAmountError);
    expect(() => toMinorUnits("1e3", 2)).toThrow(BvnkAmountError);
  });
});
