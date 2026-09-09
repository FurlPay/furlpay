import { parseUnits } from "@/app/staking";

// ---------------------------------------------------------------------------
// Decimal string -> raw units.
//
// The failure this guards is silent and expensive: `Number(raw) * 1e18` looks
// correct for every amount a developer types by hand and loses precision above
// 2^53, so a large stake is submitted for an amount the user did not enter.
// There is no downstream check that catches it — the transaction is valid, it
// is just for the wrong number.
// ---------------------------------------------------------------------------

describe("parseUnits", () => {
  it("converts whole numbers", () => {
    expect(parseUnits("1", 18)).toBe(10n ** 18n);
    expect(parseUnits("0", 18)).toBe(0n);
    expect(parseUnits("32", 18)).toBe(32n * 10n ** 18n);
  });

  it("converts fractions exactly", () => {
    expect(parseUnits("0.5", 18)).toBe(5n * 10n ** 17n);
    expect(parseUnits("1.5", 18)).toBe(15n * 10n ** 17n);
    expect(parseUnits("0.000000000000000001", 18)).toBe(1n);
  });

  // The whole reason this is string arithmetic.
  it("stays exact where floating point would not", () => {
    // 0.1 + 0.2 !== 0.3 in float; the string path has no such problem.
    expect(parseUnits("0.1", 18) + parseUnits("0.2", 18)).toBe(parseUnits("0.3", 18));
    // A value far above 2^53 that a float would round.
    expect(parseUnits("123456789.123456789123456789", 18)).toBe(123456789123456789123456789n);
  });

  it("handles a leading dot and a trailing dot", () => {
    expect(parseUnits(".5", 18)).toBe(5n * 10n ** 17n);
    expect(parseUnits("5.", 18)).toBe(5n * 10n ** 18n);
  });

  it("respects other decimal scales", () => {
    expect(parseUnits("1.5", 6)).toBe(1_500_000n);
    expect(parseUnits("1", 0)).toBe(1n);
  });

  // Truncating would quietly change the amount, so it is an error instead.
  it("refuses more fractional digits than the asset has", () => {
    expect(() => parseUnits("1.1234567", 6)).toThrow(/decimal places/i);
    expect(() => parseUnits("0.0000000000000000001", 18)).toThrow(/decimal places/i);
  });

  it("refuses anything that is not a plain decimal", () => {
    for (const bad of ["", ".", "abc", "1e18", "-1", "1,5", "0x10", " 1 2 "]) {
      expect(() => parseUnits(bad, 18)).toThrow();
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseUnits("  1.5  ", 18)).toBe(15n * 10n ** 17n);
  });
});
