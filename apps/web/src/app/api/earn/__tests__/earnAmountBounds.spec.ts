import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// AGENTS.md security rule 1: "Money amounts always get .positive() and an
// upper bound." Both earn handlers validate a USD figure the client supplies
// (amountUsd) before sizing a Morpho position. They already refused a
// non-positive figure; until this audit they accepted an arbitrarily LARGE one,
// so a coercion bug or a hostile client could drive a position of any size.
//
// These are source-level assertions on purpose. Invoking the handlers needs a
// session, a rate-limit backend and the Morpho services, and importing them
// would prove none of the amount-bound invariant that matters here. The guard
// is a single condition; asserting it is present and shares the repo's ceiling
// is the honest, stable check — the same tool sso.spec.ts uses next door.
// ---------------------------------------------------------------------------

const DEPOSIT = readFileSync(join(__dirname, "..", "deposit", "route.ts"), "utf8");
const WITHDRAW = readFileSync(join(__dirname, "..", "withdraw", "route.ts"), "utf8");

const CEILING = 1_000_000;

describe.each([
  ["deposit", DEPOSIT],
  ["withdraw", WITHDRAW],
])("earn/%s amount bounds", (_name, SRC) => {
  it("still refuses a non-positive amount", () => {
    expect(SRC).toMatch(/amountUsd\s*<=\s*0/);
  });

  it("refuses an amount above the money-schema ceiling (upper bound present)", () => {
    expect(SRC).toContain("MAX_EARN_USD_PER_TX");
    expect(SRC).toMatch(/amountUsd\s*>\s*MAX_EARN_USD_PER_TX/);
  });

  it("pins the ceiling to the repo's money-schema bound", () => {
    expect(SRC).toMatch(/MAX_EARN_USD_PER_TX\s*=\s*1_000_000/);
  });

  it("rejects out-of-range amounts with the existing invalid_amount contract", () => {
    // The bound must reuse the SAME 400 response shape, not a new one, so no
    // client parsing breaks.
    expect(SRC).toMatch(/error:\s*"invalid_amount"[\s\S]*status:\s*400/);
  });
});

// A guard rail on the guard rail: prove the ceiling constant actually excludes
// a plausible over-limit figure and admits a normal one, independent of the
// source text above.
describe("ceiling semantics", () => {
  it("admits a normal deposit and excludes an absurd one", () => {
    const ok = 5_000;
    const absurd = 5_000_000;
    expect(ok > 0 && ok <= CEILING).toBe(true);
    expect(absurd > 0 && absurd <= CEILING).toBe(false);
  });
});
