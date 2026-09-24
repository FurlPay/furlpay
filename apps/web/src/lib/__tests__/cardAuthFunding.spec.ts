import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// What is allowed to fund a card authorisation.
//
// The JIT webhook decides, inside the issuer's latency budget, whether a swipe
// is approved. It may only count money FurlPay can actually collect at
// settlement — an approval against anything else means Visa pays the merchant
// and FurlPay holds no claim.
//
// These are source assertions rather than behavioural ones because the property
// is an ABSENCE: that a particular balance is not consulted, and that a
// particular address is not read. A behavioural test cannot observe a call that
// was never made, and the regression here is someone ADDING one back.
// ---------------------------------------------------------------------------

const source = readFileSync(
  join(__dirname, "..", "..", "app", "api", "webhooks", "card-auth", "route.ts"),
  "utf8"
);

/**
 * The route with comments removed.
 *
 * Asserted against CODE, not prose. The route deliberately EXPLAINS why it does
 * not read an on-chain balance and why `user.linkedWallet` is the wrong fix —
 * so a naive text search finds those very strings in the comment that exists to
 * prevent them. Stripping comments first is what makes "this identifier does not
 * appear" mean "this identifier is not used".
 */
const route = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\s\/\/.*$/gm, "");

describe("the card-auth JIT decision counts only capturable funds", () => {
  it("does not read an on-chain balance at all", () => {
    // The previous read targeted `user.safeAddress`, which store.ts builds as
    // "0x" + sha256("furlpay:safe:" + key).slice(0,40) — a truncated hash with
    // no private key behind it. docs/BALANCE-CUSTODY-MAP.md: "even the one real
    // read is against a dead address."
    expect(route).not.toContain("getUsdcBalanceWithBudget");
    expect(route).not.toContain("chainBalance");
  });

  it("never substitutes the signature-proven linked wallet", () => {
    // The obvious "fix", and the dangerous one. A linked wallet is
    // self-custodial: the user holds the key, and nothing on the card path can
    // pull from it (no EIP-3009 authorisation, allowance or pre-auth exists).
    // Counting it would authorise funds FurlPay cannot collect.
    expect(route).not.toContain("user.linkedWallet");
  });

  it("states the stablecoin leg as zero, explicitly", () => {
    // Named rather than omitted, so the decision is visible at the call site
    // instead of being an absence someone has to notice.
    expect(route).toMatch(/const stablecoinSpendableUsd = 0;/);
    expect(route).toMatch(/const spendableUsd = stablecoinSpendableUsd \+ fiatUsd;/);
  });

  it("records what actually funded an approval", () => {
    expect(route).toContain('fundingSource: "fiat"');
  });

  it("still declines when fiat cannot cover the authorisation", () => {
    // The guard itself must survive. Removing it is the one edit that turns
    // this from conservative into unbounded.
    expect(route).toMatch(/if \(spendableUsd < auth\.amountUsd\)/);
    expect(route).toContain('"insufficient_funds_on_chain"');
  });

  it("keeps the reasoning next to the code", () => {
    // The comment is the control here: without it the next reader sees a
    // hardcoded zero, assumes it is an oversight, and points the read at
    // `linkedWallet`. Asserted against the RAW source, comments included.
    expect(source).toContain("THE STABLECOIN LEG CONTRIBUTES NOTHING, ON PURPOSE");
    expect(source).toContain("SELF-CUSTODIAL");
    expect(source).toContain("unfunded authorisation");
  });

  it("does not let RPC health widen spending authority", () => {
    // The removed helper fell back to the full ledger stablecoin figure on
    // timeout, so a slow Arbitrum RPC made the card MORE permissive — anyone
    // able to slow it gained the difference. Nothing in this route may
    // reintroduce a ledger-sum fallback on an infrastructure failure.
    expect(route).not.toContain("stableLedgerUsd");
    expect(route).not.toMatch(/tokenBalances\.reduce/);
  });
});
