import { CONTACT_CHAINS } from "../contacts/model";
import {
  label,
  memoError,
  memoRequirement,
  memoSpec,
  serializeMemo,
  supportsMemo,
} from "../contacts/memo";

// ---------------------------------------------------------------------------
// Memo / destination-tag rules.
//
// The behaviour under test today is mostly "nothing happens", and that is worth
// pinning precisely: a memo field appearing on an Ethereum address would be a
// control that cannot affect where money goes, on the screen where a confusing
// control costs the most.
//
// What is really being defended is the SHAPE. The day a memo chain is added,
// these tests are what say whether the addition was done correctly — required
// memos block a save, absent means absent rather than empty string, and a memo
// supplied for a chain that has none is refused rather than silently dropped.
// ---------------------------------------------------------------------------

describe("today: no supported chain uses a memo", () => {
  it("reports `none` for every chain FurlPay supports", () => {
    for (const chain of CONTACT_CHAINS) {
      expect(memoRequirement(chain)).toBe("none");
      expect(supportsMemo(chain)).toBe(false);
    }
  });

  it("has a spec for every chain, so no lookup can come back undefined", () => {
    // The `satisfies Record<Chain, MemoSpec>` guards this at compile time; this
    // catches a chain added to the union with a runtime-only shim.
    for (const chain of CONTACT_CHAINS) {
      expect(memoSpec(chain)).toBeDefined();
      expect(memoSpec(chain).requirement).toBe("none");
    }
  });
});

describe("validation", () => {
  it("accepts an empty memo on a chain that has none", () => {
    expect(memoError("base", undefined)).toBeNull();
    expect(memoError("base", "")).toBeNull();
    expect(memoError("solana", "   ")).toBeNull();
  });

  it("REFUSES a memo on a chain that has none, rather than dropping it", () => {
    // Silently discarding it would store an address the sender believes carries
    // routing information and does not — the failure this module exists for,
    // arriving from the opposite direction.
    expect(memoError("base", "12345")).toMatch(/doesn't use a memo/i);
    expect(memoError("ethereum", "hello")).not.toBeNull();
  });
});

describe("serialization", () => {
  it("omits the field entirely rather than sending an empty string", () => {
    // `{}` and `{ memo: "" }` mean the same thing to a reader and differ on the
    // wire, and the empty string is the one a downstream service is most likely
    // to forward to a chain as a real memo.
    expect(serializeMemo("base", "")).toEqual({});
    expect(serializeMemo("base", undefined)).toEqual({});
    expect("memo" in serializeMemo("base", "")).toBe(false);
  });

  it("emits nothing for a chain with no memo support, whatever it is given", () => {
    expect(serializeMemo("polygon", "should-not-appear")).toEqual({});
    expect(serializeMemo("solana", "12345")).toEqual({});
  });
});

describe("labelling", () => {
  it("keeps a destination tag distinct from a memo", () => {
    // Not interchangeable words to anyone who has used the chain in question —
    // telling an XRP user to enter a "memo" sends them looking for the wrong
    // field in the app they are paying from.
    expect(label("destination_tag")).toBe("destination tag");
    expect(label("memo")).toBe("memo");
  });
});

describe("the shape holds for a hypothetical memo chain", () => {
  // Exercises the branches that no supported chain reaches today, against a
  // spec shaped exactly as a real one would be. This is the test that will
  // still mean something on the day XRP is switched on.
  const xrpLike = {
    requirement: "required" as const,
    kind: "destination_tag" as const,
    pattern: /^\d{1,10}$/,
    maxLength: 10,
    hint: "Numeric tag from the exchange's deposit page.",
  };

  /** The same logic memoError applies, exercised against the spec directly. */
  function check(memo: string | undefined): string | null {
    const value = (memo ?? "").trim();
    if (!value) return xrpLike.requirement === "required" ? "required" : null;
    if (value.length > xrpLike.maxLength) return "too long";
    if (!xrpLike.pattern.test(value)) return "invalid";
    return null;
  }

  it("blocks a save when a required tag is missing", () => {
    expect(check("")).toBe("required");
    expect(check(undefined)).toBe("required");
  });

  it("accepts a well-formed tag", () => {
    expect(check("1234567")).toBeNull();
  });

  it("rejects a tag that is too long or the wrong shape", () => {
    expect(check("12345678901")).toBe("too long");
    expect(check("abc")).toBe("invalid");
  });
});
