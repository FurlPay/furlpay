import { describe, it, expect } from "vitest";
import { ASSETS, Money, MoneyError, requireAsset } from "../money";

const INR = ASSETS.INR;
const USDC = ASSETS["USDC.arbitrum"];
const ETH = ASSETS["ETH.ethereum"];

// ---------------------------------------------------------------------------
// Money.
//
// Each block below is a specific way a float-based amount goes wrong. The
// property under test throughout is that the wrong thing is UNREPRESENTABLE,
// not merely discouraged.
// ---------------------------------------------------------------------------

describe("construction", () => {
  it("parses a decimal string exactly", () => {
    expect(Money.parse("125.50", INR).minor).toBe(12550n);
    expect(Money.parse("0.01", INR).minor).toBe(1n);
    expect(Money.parse("1000000", INR).minor).toBe(100000000n);
  });

  it("round-trips through toDecimalString", () => {
    for (const input of ["0.00", "0.01", "1.00", "999999.99"]) {
      expect(Money.parse(input, INR).toDecimalString()).toBe(input);
    }
  });

  it("REFUSES more precision than the asset has, rather than rounding", () => {
    // Silently dropping a digit is how a payout becomes a rounding donation.
    // Only the caller knows whether truncating is the correct business rule.
    expect(() => Money.parse("1.005", INR)).toThrow(MoneyError);
    expect(() => Money.parse("1.0000001", USDC)).toThrow(MoneyError);
  });

  it("accepts full precision for an 18-decimal asset", () => {
    const wei = Money.parse("1.000000000000000001", ETH);
    expect(wei.minor).toBe(1_000_000_000_000_000_001n);
  });

  it("stays exact well beyond Number.MAX_SAFE_INTEGER", () => {
    // 9 ETH in wei already exceeds float64's safe integer range, so any
    // number-based representation is wrong before a user hits double digits.
    const large = Money.parse("1000000.000000000000000001", ETH);
    expect(large.toDecimalString()).toBe("1000000.000000000000000001");
    expect(large.minor > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("rejects text that is not a decimal", () => {
    for (const bad of ["", "abc", "1.2.3", "1e5", "1,000", " "]) {
      expect(() => Money.parse(bad, INR), bad).toThrow(MoneyError);
    }
  });
});

describe("arithmetic", () => {
  it("does not accumulate float error", () => {
    // 0.1 + 0.2 !== 0.3 in float64. Ten additions of ₹0.10 must be ₹1.00.
    let total = Money.zero(INR);
    for (let i = 0; i < 10; i++) total = total.plus(Money.parse("0.10", INR));
    expect(total.toDecimalString()).toBe("1.00");
    expect(total.minor).toBe(100n);
  });

  it("refuses to add different assets", () => {
    // Both are Money, so no compiler catches this. ₹100 + 100 USDC has no
    // meaning and picking one side's asset would invent an exchange rate.
    expect(() => Money.parse("100", INR).plus(Money.parse("100", USDC))).toThrow(/Cannot add/);
  });

  it("refuses to add the same symbol on different chains", () => {
    const arb = Money.parse("100", ASSETS["USDC.arbitrum"]);
    const base = Money.parse("100", ASSETS["USDC.base"]);
    // USDC on Arbitrum cannot settle a Base obligation. Treating them as one
    // asset is how a deposit is credited against the wrong chain's balance.
    expect(() => arb.plus(base)).toThrow(/Cannot add/);
  });
});

describe("scale — fees and FX as rationals", () => {
  it("computes a 0.5% fee exactly", () => {
    // 1/200, not 0.005. The float literal 0.005 is not exactly 0.005.
    const fee = Money.parse("1000.00", INR).scale(1n, 200n, "floor");
    expect(fee.toDecimalString()).toBe("5.00");
  });

  it("applies the rounding mode the caller chose", () => {
    const amount = Money.parse("100.05", INR); // 10005 paise
    expect(amount.scale(1n, 2n, "floor").minor).toBe(5002n);
    expect(amount.scale(1n, 2n, "ceil").minor).toBe(5003n);
    expect(amount.scale(1n, 2n, "half-up").minor).toBe(5003n);
  });

  it("rounds half-up only at or above the halfway point", () => {
    expect(Money.ofMinor(10n, INR).scale(1n, 4n, "half-up").minor).toBe(3n); // 2.5 -> 3
    expect(Money.ofMinor(9n, INR).scale(1n, 4n, "half-up").minor).toBe(2n); // 2.25 -> 2
  });

  it("refuses a zero denominator instead of returning Infinity", () => {
    expect(() => Money.parse("100", INR).scale(1n, 0n, "floor")).toThrow(MoneyError);
  });
});

describe("allocate — the parts must sum to the whole", () => {
  it("distributes an indivisible remainder without losing it", () => {
    // ₹10.00 three ways. Divide-and-round loses a paisa; a system that loses a
    // paisa per split cannot reconcile.
    const parts = Money.parse("10.00", INR).allocate(3);
    expect(parts.map((p) => p.toDecimalString())).toEqual(["3.34", "3.33", "3.33"]);
    const sum = parts.reduce((a, b) => a.plus(b), Money.zero(INR));
    expect(sum.minor).toBe(1000n);
  });

  it("holds the sum invariant across many shapes", () => {
    for (const [amount, parts] of [
      ["0.01", 3],
      ["100.00", 7],
      ["999999.99", 11],
      ["1.00", 1],
    ] as const) {
      const original = Money.parse(amount, INR);
      const sum = original.allocate(parts).reduce((a, b) => a.plus(b), Money.zero(INR));
      expect(sum.minor, `${amount}/${parts}`).toBe(original.minor);
    }
  });

  it("rejects a non-positive or fractional part count", () => {
    for (const bad of [0, -1, 2.5, Number.NaN]) {
      expect(() => Money.parse("10.00", INR).allocate(bad), String(bad)).toThrow(MoneyError);
    }
  });
});

describe("serialisation", () => {
  it("puts minor units on the wire as a STRING", () => {
    // JSON has no bigint. A number here would silently degrade an 18-decimal
    // amount through float64 on the way back in.
    const json = Money.parse("1.000000000000000001", ETH).toJSON();
    expect(typeof json.minor).toBe("string");
    expect(json.minor).toBe("1000000000000000001");
    expect(json.asset).toBe("ETH.ethereum");
  });
});

describe("asset registry", () => {
  it("carries the settlement domain for on-chain assets and null for fiat", () => {
    expect(ASSETS["USDC.arbitrum"].chain).toBe("arbitrum");
    expect(ASSETS.INR.chain).toBeNull();
  });

  it("throws on an unknown asset rather than inventing one", () => {
    // Bare "USDC" must always throw: there is no chain-agnostic USDC in this
    // system. An amount is only meaningful once its settlement domain is known,
    // which is the whole reason asset ids carry a chain.
    expect(() => requireAsset("USDC")).toThrow(/Unknown asset/);

    // A REAL chain FurlPay does not support, rather than a nonsense string.
    // That is the mistake this guard actually catches — code referencing a
    // plausible network the registry has no deployment for.
    //
    // This assertion used to name "USDC.solana", which was correct until
    // 38ce9bd added Solana USDC to the registry. The test then failed for the
    // right reason (the asset exists now) but read as a safety regression.
    // Asserting against an unsupported chain keeps the property while leaving
    // the registry free to grow.
    expect(() => requireAsset("USDC.avalanche")).toThrow(/Unknown asset/);
  });

  it("knows every chain domain the registry actually carries", () => {
    // The counterpart to the guard above: adding a deployment must not require
    // editing a hardcoded list somewhere else to keep it usable. If a domain is
    // in ASSETS it resolves, with the decimals and chain it was registered with.
    for (const id of ["USDC.arbitrum", "USDC.base", "USDC.ethereum", "USDC.polygon", "USDC.solana", "USDC.arc"]) {
      const asset = requireAsset(id);
      expect(asset.id).toBe(id);
      expect(asset.symbol).toBe("USDC");
      expect(asset.chain).toBe(id.split(".")[1]);
    }
  });
});
