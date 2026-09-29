"use strict";
// ---------------------------------------------------------------------------
// Money as integers.
//
// THE PROPERTY UNDER TEST: no float ever reaches an authorization boundary.
// The first test is the concrete failure this whole module exists to prevent.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert");
const {
  parseAtomic,
  mustParseAtomic,
  majorToAtomic,
  atomicToMajor,
  sumAtomic,
  maxAtomic,
  decimalsFor,
  AtomicError,
  ASSET_DECIMALS,
} = require("../dist/index.js");

test("the float bug this module prevents, demonstrated and then avoided", () => {
  // In IEEE-754 a $0.30 cap refuses a legitimate $0.20 after $0.10 was spent.
  assert.strictEqual(0.1 + 0.2 > 0.3, true, "the bug is real in floats");

  // In integer minor units it does not happen.
  const spent = mustParseAtomic(majorToAtomic("0.10", 6), "spent");
  const amount = mustParseAtomic(majorToAtomic("0.20", 6), "amount");
  const cap = mustParseAtomic(majorToAtomic("0.30", 6), "cap");
  assert.strictEqual(spent + amount > cap, false, "integers compare correctly");
  assert.strictEqual(spent + amount === cap, true);
});

test("summing the same amount many times is exact", () => {
  // 69 additions of 0.1 reach 6.8999999999999915 in floats, not 6.90.
  const floatSum = Array.from({ length: 69 }).reduce((t) => t + 0.1, 0);
  assert.notStrictEqual(floatSum, 6.9, "floats drift");

  const parts = Array.from({ length: 69 }, () => majorToAtomic("0.1", 6));
  assert.strictEqual(sumAtomic(parts), majorToAtomic("6.9", 6), "integers do not");
});

test("two parties summing in different orders reach the same total", () => {
  const a = ["100", "250", "3"];
  const b = ["3", "100", "250"];
  assert.strictEqual(sumAtomic(a), sumAtomic(b));
});

// ── Parsing ──────────────────────────────────────────────────────────────

test("only integer literals parse; everything else is null", () => {
  assert.strictEqual(parseAtomic("100"), 100n);
  assert.strictEqual(parseAtomic("-5"), -5n);
  assert.strictEqual(parseAtomic("0"), 0n);
  assert.strictEqual(parseAtomic(" 42 "), 42n, "surrounding whitespace is tolerated");
  for (const bad of ["1.5", "1e6", "", "abc", "0x10", "1,000", null, undefined, 100, {}, []]) {
    assert.strictEqual(parseAtomic(bad), null, `${JSON.stringify(bad)} must not parse`);
  }
});

test("a NUMBER is refused — accepting one would reopen the float path", () => {
  assert.strictEqual(parseAtomic(28500000), null);
  assert.throws(() => mustParseAtomic(28500000, "amount"), AtomicError);
});

test("mustParseAtomic names the offending field", () => {
  assert.throws(
    () => mustParseAtomic("nope", "maxAmountPerTxAtomic"),
    (e) => e instanceof AtomicError && /maxAmountPerTxAtomic/.test(e.message)
  );
});

// ── Major <-> atomic conversion ──────────────────────────────────────────

test("major-to-atomic conversion is exact for the cases floats get wrong", () => {
  assert.strictEqual(majorToAtomic("28.50", 6), "28500000");
  // 28.50 * 1e6 in floating point is not always 28500000 exactly; the textual
  // decimal shift has no such failure mode.
  assert.strictEqual(majorToAtomic("0.000001", 6), "1");
  assert.strictEqual(majorToAtomic("1", 6), "1000000");
  assert.strictEqual(majorToAtomic("0", 6), "0");
  assert.strictEqual(majorToAtomic("-1.5", 6), "-1500000");
  assert.strictEqual(majorToAtomic("1000000", 2), "100000000");
  assert.strictEqual(majorToAtomic(".5", 6), "500000");
  assert.strictEqual(majorToAtomic("1.", 6), "1000000");
});

test("more fractional digits than the asset carries is REFUSED, not rounded", () => {
  // Silently dropping a digit changes the amount a human authorized.
  assert.throws(() => majorToAtomic("1.0000001", 6), AtomicError);
  assert.throws(
    () => majorToAtomic("0.005", 2),
    (e) => /Rounding here would change the authorized amount/.test(e.message)
  );
  assert.strictEqual(majorToAtomic("0.01", 2), "1", "exactly representable is fine");
});

test("non-decimal input is refused", () => {
  for (const bad of ["", ".", "abc", "1.2.3", "1e5", "--1"]) {
    assert.throws(() => majorToAtomic(bad, 6), AtomicError, `${bad} must be refused`);
  }
});

test("an unsupported decimals argument is refused", () => {
  assert.throws(() => majorToAtomic("1", -1), AtomicError);
  assert.throws(() => majorToAtomic("1", 1.5), AtomicError);
  assert.throws(() => majorToAtomic("1", 99), AtomicError);
});

test("round-tripping through atomic and back is lossless", () => {
  for (const [major, decimals] of [
    ["28.500000", 6],
    ["0.000001", 6],
    ["1.000000", 6],
    ["123456.78", 2],
    ["-0.500000", 6],
    ["1.000000000000000001", 18],
  ]) {
    const atomic = majorToAtomic(major, decimals);
    assert.strictEqual(atomicToMajor(atomic, decimals), major, `${major} round-trips`);
  }
});

test("atomicToMajor pads correctly for sub-unit amounts", () => {
  assert.strictEqual(atomicToMajor("1", 6), "0.000001");
  assert.strictEqual(atomicToMajor("0", 6), "0.000000");
  assert.strictEqual(atomicToMajor("-1", 6), "-0.000001");
  assert.strictEqual(atomicToMajor("100", 0), "100");
});

// ── Asset decimals ───────────────────────────────────────────────────────

test("an UNKNOWN asset returns null rather than a guessed default", () => {
  // Guessing 6 for an 18-decimal token authorizes a payment 10^12 times the
  // intended size, and the numbers compare cleanly the whole way.
  assert.strictEqual(decimalsFor("NOT_A_REAL_TOKEN"), null);
  assert.strictEqual(decimalsFor(""), null);
});

test("known assets report their real decimals", () => {
  assert.strictEqual(decimalsFor("USDC"), 6);
  assert.strictEqual(decimalsFor("usdc"), 6, "case-insensitive");
  assert.strictEqual(decimalsFor(" USDC "), 6, "whitespace-tolerant");
  assert.strictEqual(decimalsFor("DAI"), 18);
  assert.strictEqual(decimalsFor("SOL"), 9);
  assert.strictEqual(decimalsFor("USD"), 2);
});

test("the decimals table has no zero or negative entries", () => {
  for (const [asset, d] of Object.entries(ASSET_DECIMALS)) {
    assert.ok(Number.isInteger(d) && d >= 0 && d <= 36, `${asset} has sane decimals`);
  }
});

test("the SAME nominal amount in two assets produces DIFFERENT atomic values", () => {
  // The reason asset and network must be equal before any comparison: these two
  // integers would compare as though they were the same amount.
  const usdc = majorToAtomic("1", decimalsFor("USDC"));
  const dai = majorToAtomic("1", decimalsFor("DAI"));
  assert.notStrictEqual(usdc, dai);
  assert.strictEqual(usdc, "1000000");
  assert.strictEqual(dai, "1000000000000000000");
});

// ── Helpers ──────────────────────────────────────────────────────────────

test("sumAtomic on an empty list is zero, not an error", () => {
  assert.strictEqual(sumAtomic([]), "0");
});

test("sumAtomic rejects a non-integer member rather than skipping it", () => {
  assert.throws(() => sumAtomic(["100", "1.5"]), AtomicError);
});

test("maxAtomic compares numerically, not lexically", () => {
  // Lexical comparison would call "9" larger than "100".
  assert.strictEqual(maxAtomic("100", "9"), "100");
  assert.strictEqual(maxAtomic("9", "100"), "100");
  assert.strictEqual(maxAtomic("-5", "-10"), "-5");
  assert.strictEqual(maxAtomic("5", "5"), "5");
});

test("very large amounts do not lose precision", () => {
  // Beyond Number.MAX_SAFE_INTEGER, where a float silently rounds.
  const huge = "9007199254740993"; // 2^53 + 1
  assert.strictEqual(mustParseAtomic(huge, "x").toString(), huge);
  assert.notStrictEqual(String(Number(huge)), huge, "a float would have rounded this");
  assert.strictEqual(sumAtomic([huge, "1"]), "9007199254740994");
});
