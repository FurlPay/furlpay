import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAtomicAmount } from "@/lib/x402Assets";

// ---------------------------------------------------------------------------
// F-20: the last gate before money moves must parse amounts strictly.
//
// THE REPOSITORY ALREADY HAS ONE RULE for what an atomic amount looks like —
// `parseAtomicAmount` (F-9), mirroring `parseAtomic` in the control-plane
// package. `BigInt` on its own is not that rule, and the difference is not
// theoretical: it accepts hex, octal, binary, a leading sign, surrounding
// whitespace, and the empty string as ZERO.
//
// TWO PLACES STILL USED THE BARE FORM, and both are downstream of the
// signature check rather than upstream:
//
//   · `x402Settler.ts` — builds the `transferWithAuthorization` args. This is
//     the last line before a transaction is signed and broadcast.
//   · `app/api/x402/policy/settle/route.ts` — `toAuth()` reads `value`,
//     `validAfter` and `validBefore` straight off the request body.
//
// WHY IT MATTERS EVEN THOUGH EIP-712 HASHES NUMERICALLY. A signature over
// `"0x10"` and one over `"16"` produce the same digest, so no signature is
// bypassed — that part must not be overclaimed. What breaks is AGREEMENT:
// `recordSettlement` stores `amountAtomic` verbatim, so the settlement record
// and the evidence trail would read `"0x10"` while the chain moved 16. Two
// parsers reading one field and disagreeing is the shape most authorization
// bypasses have, and it is exactly what F-9 wrote down.
//
// This is a SOURCE-LEVEL test on purpose. Driving the settler needs a funded
// key on a real chain, which is an external dependency this audit does not
// have; what can be verified without one is that the money path calls the
// repository's own parser rather than the coercing built-in.
// ---------------------------------------------------------------------------

const WEB = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(WEB, "src", ...p.split("/")), "utf8");

/** Strip comments so a documented example is not mistaken for live code. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("the shared parser is the one rule", () => {
  it("rejects every shape BigInt silently coerces", () => {
    for (const bad of ["0x10", "0o17", "0b101", "+5", "-5", " 1 ", "", "   ", "1e6", "1.5"]) {
      expect(parseAtomicAmount(bad), `"${bad}" was accepted`).toBeNull();
    }
  });

  it("accepts canonical decimal strings, including zero-padded ones", () => {
    expect(parseAtomicAmount("0")).toBe(0n);
    expect(parseAtomicAmount("1000000")).toBe(1000000n);
    // Some clients zero-pad; refusing it would cost a real payment for no gain.
    expect(parseAtomicAmount("007")).toBe(7n);
    expect(parseAtomicAmount("9".repeat(40))).toBe(BigInt("9".repeat(40)));
  });
});

describe("the settler parses strictly before it signs", () => {
  const src = code(read("lib/x402Settler.ts"));

  it("does not pass a bare BigInt() of an authorization field to writeContract", () => {
    // The exact defect: `BigInt(auth.value)` inline in the args array.
    expect(src).not.toMatch(/BigInt\(\s*auth\.(value|validAfter|validBefore)\s*\)/);
  });

  it("uses the repository's parser", () => {
    expect(src).toMatch(/parseAtomicAmount/);
  });

  it("refuses rather than coercing when the amount is not canonical", () => {
    // A malformed amount must stop the settlement, not be rounded into one.
    expect(src).toMatch(/invalid_amount|amount_malformed|non-canonical/i);
  });
});

describe("the policy settle route parses strictly", () => {
  const src = code(read("app/api/x402/policy/settle/route.ts"));

  it("does not build an Authorization with bare BigInt() of body fields", () => {
    expect(src).not.toMatch(/value:\s*BigInt\(\s*a\.value\s*\)/);
    expect(src).not.toMatch(/validAfter:\s*BigInt\(\s*a\.validAfter\s*\)/);
    expect(src).not.toMatch(/validBefore:\s*BigInt\(\s*a\.validBefore\s*\)/);
  });

  it("uses the repository's parser", () => {
    expect(src).toMatch(/parseAtomicAmount/);
  });
});

describe("no money path anywhere reintroduces the bare form", () => {
  const MONEY_PATHS = [
    "lib/x402Settler.ts",
    "lib/x402Facilitator.ts",
    "lib/x402Signature.ts",
    "app/api/x402/policy/settle/route.ts",
  ];

  it("none of them calls BigInt directly on an authorization amount field", () => {
    // A sweep rather than four assertions, so a NEW money path added to this
    // list is covered the moment somebody adds it.
    for (const p of MONEY_PATHS) {
      const src = code(read(p));
      const hits = [...src.matchAll(/BigInt\(\s*[a-zA-Z_$][\w$]*\.(value|validAfter|validBefore)\s*\)/g)];
      expect(hits.map((h) => h[0]), `${p} parses an amount with a bare BigInt`).toEqual([]);
    }
  });
});
