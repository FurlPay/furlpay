import { describe, it, expect } from "vitest";
import { requiredConfirmations } from "@/lib/x402";

// ---------------------------------------------------------------------------
// F-18: the confirmation-depth gate must never be weakened by a malformed
// amount.
//
// WHAT THIS FUNCTION DOES. x402's revert-grant attack: a server that releases a
// resource on a non-final settlement can be left unpaid if the transaction is
// later reorged. The mitigation is to wait for k confirmations scaled to the
// value at risk — 3 for sub-$1, 6 below $10, 12 above. So this function chooses
// how much finality to demand, and a WRONG answer in the low direction is a
// real weakening of a real control.
//
// THE DEFECT. The tier was selected from `Number(BigInt(amountAtomic)) / 1e6`
// and the first branch was `usd < 1 → 3`. A negative amount satisfies `usd < 1`,
// so `"-99999999999"` selected the WEAKEST gate. Zero did the same. Every other
// malformed input already failed closed (a parse failure demanded 12), which is
// what makes this one worth fixing rather than shrugging at: the surrounding
// code establishes the fail-closed convention and this path quietly broke it.
//
// EXPLOITABILITY: LOW, and the fix is still correct. `parseAtomic` rejects
// negatives before an amount reaches a decision, so no known route delivers one
// here. But seven call sites pass a value that originated in an attacker-shaped
// authorization, and "a different function rejects it first" is precisely the
// assumption defence-in-depth exists to stop relying on.
//
// THE PRECISION QUESTION, since this deliberately uses a float. Beyond 2^53,
// `Number(BigInt(x))` loses precision — but only upward, toward a LARGER usd,
// which selects a STRONGER gate. The error direction is safe, so the float
// stays rather than being replaced with BigInt comparisons that would change
// nothing except the diff.
// ---------------------------------------------------------------------------

describe("confirmation depth scales with value at risk", () => {
  it("demands 3 confirmations below $1", () => {
    expect(requiredConfirmations("1")).toBe(3);
    expect(requiredConfirmations("500000")).toBe(3); // $0.50
    expect(requiredConfirmations("999999")).toBe(3);
  });

  it("demands 6 confirmations between $1 and $10", () => {
    expect(requiredConfirmations("1000000")).toBe(6); // $1.00
    expect(requiredConfirmations("5000000")).toBe(6);
    expect(requiredConfirmations("9999999")).toBe(6);
  });

  it("demands 12 confirmations at $10 and above", () => {
    expect(requiredConfirmations("10000000")).toBe(12);
    expect(requiredConfirmations("50000000")).toBe(12);
  });
});

describe("every malformed amount demands the STRONGEST gate", () => {
  it("a negative amount does not select the weakest tier", () => {
    // The defect. `-99999999999` satisfied `usd < 1` and returned 3.
    expect(requiredConfirmations("-99999999999")).toBe(12);
    expect(requiredConfirmations("-1")).toBe(12);
  });

  it("zero does not select the weakest tier", () => {
    // A zero-value settlement is not a cheap settlement; it is a nonsensical
    // one, and the right response to nonsense is maximum caution.
    expect(requiredConfirmations("0")).toBe(12);
  });

  it("an unparseable amount demands 12", () => {
    for (const bad of ["", "   ", "abc", "1.5", "0x10", "1e6", "+5", "NaN", "Infinity"]) {
      expect(requiredConfirmations(bad), `"${bad}" weakened the gate`).toBe(12);
    }
  });

  it("an absurdly large amount demands 12, not fewer", () => {
    // Precision loss here pushes usd UP, which is the safe direction.
    expect(requiredConfirmations("9".repeat(40))).toBe(12);
  });

  it("no input anywhere returns fewer than 3", () => {
    // A sweep: whatever arrives, the floor holds.
    const inputs = [
      "", "0", "-0", "-1", "1", "999999", "1000000", "10000000",
      "abc", "1.5", "0x10", "1e6", "-1e6", "  7  ", "9".repeat(80),
    ];
    for (const v of inputs) {
      const k = requiredConfirmations(v);
      expect(k, `"${v}" produced ${k}`).toBeGreaterThanOrEqual(3);
      expect([3, 6, 12]).toContain(k);
    }
  });
});
