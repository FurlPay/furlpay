import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// SEC-P3-002: an Idempotency-Key must be bound to the request it was first
// used with. Without `request`, a reused key carrying a DIFFERENT transfer
// (amount, recipient) was answered with the first transfer's cached success,
// so the client believed a payment happened that never did. withIdempotency
// already refuses a mismatched body when it is given one; this guard makes
// every route give it one, or explain why not.

const API = join(__dirname, "..", "..", "app", "api");

/** Routes that call withIdempotency without `request`, and why that is safe. */
const NO_BODY_TO_BIND: Record<string, string> = {
  "membership/cashback/claim": "no request body; the claim is per user and per period",
  "p2p/orders/[id]/release": "no request body; the order id is in the path",
  "topup/apple-pay": "body is validated inside the handler; the credit is keyed to Apple's transaction id",
  "transactions/status": "read-only reconciliation lookup, not an executing request",
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : routeFiles(p);
    return name === "route.ts" ? [p] : [];
  });
}

describe("idempotency keys are bound to their request (SEC-P3-002)", () => {
  const callers = routeFiles(API).filter((f) => readFileSync(f, "utf8").includes("withIdempotency("));
  const route = (f: string) => relative(API, f).split(sep).slice(0, -1).join("/");

  it("finds the money routes (the scan is not vacuous)", () => {
    expect(callers.length).toBeGreaterThanOrEqual(20);
    expect(callers.map(route)).toContain("wallets/transfer");
  });

  it("every caller passes `request`, or is listed with a reason", () => {
    const missing = callers
      .filter((f) => !/withIdempotency\([\s\S]*?request:/.test(readFileSync(f, "utf8")))
      .map(route)
      .filter((r) => !(r in NO_BODY_TO_BIND));
    expect(missing).toEqual([]);
  });

  it("the exceptions list has no stale entries", () => {
    const present = new Set(callers.map(route));
    expect(Object.keys(NO_BODY_TO_BIND).filter((r) => !present.has(r))).toEqual([]);
  });
});
