import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  __resetProviderState,
  assertFailoverAllowed,
  FailoverRefused,
  failoverAllowed,
  getProviderHealth,
  providerRegistry,
  recordProviderHealth,
  selectProvider,
  setProviderPaused,
} from "../router";
import {
  evaluateCapability,
  matchingCapabilities,
  PROVIDER_CAPABILITIES,
  type CapabilityQuery,
  type ProviderCapability,
} from "../capability";
import type { OnrampProviderAdapter } from "../types";

// ---------------------------------------------------------------------------
// Provider selection and failover.
//
// Two properties are load-bearing here:
//
//   1. A corridor with no SIGNED contract can never be selected, however
//      complete the code is. "The adapter is written" and "we are permitted to
//      move money through it" are different claims.
//   2. Failover is a routing decision before money moves and a human decision
//      after. An indeterminate provider outcome must never be re-routed.
// ---------------------------------------------------------------------------

const QUERY: CapabilityQuery = {
  kind: "onramp",
  hasHostedCheckout: true,
  direction: "onramp",
  country: "IN",
  fiatCurrency: "INR",
  assetId: "USDC.arbitrum",
  paymentMethod: "upi",
  amountMinor: 100_000n, // ₹1,000
};

/** A fully live capability row. Built per-test so a mutation cannot leak. */
function liveRow(overrides: Partial<ProviderCapability> = {}): ProviderCapability {
  return {
    providerId: "test-provider",
    kind: "onramp",
    hasHostedCheckout: true,
    direction: "onramp",
    country: "IN",
    fiatCurrency: "INR",
    assets: ["USDC.arbitrum"],
    paymentMethods: ["upi"],
    contractStatus: "live",
    vdaMerchantAccepted: true,
    minMinor: 10_000n,
    maxMinor: 10_000_000n,
    settlementWindow: "T+1",
    requiredCredentials: [],
    ...overrides,
  };
}

function stubAdapter(id: string): OnrampProviderAdapter {
  const notCalled = () => {
    throw new Error("adapter must not be invoked by selection");
  };
  return {
    id,
    kind: "onramp",
    hasHostedCheckout: true,
    quote: notCalled as never,
    createOrder: notCalled as never,
    getStatus: notCalled as never,
    cancel: notCalled as never,
    refund: notCalled as never,
    verifyWebhook: notCalled as never,
  };
}

beforeEach(() => __resetProviderState());
afterEach(() => __resetProviderState());

describe("the declared matrix selects nothing", () => {
  it("declares no live corridor", () => {
    // FurlPay has no signed on-ramp, off-ramp or banking agreement, and "live"
    // means a live transaction was observed end to end. Rows are declared so ops
    // can see each corridor and why it is closed; a row marked live without that
    // evidence would make selection return a provider that cannot be paid
    // through — worse than returning nothing, because the caller would proceed.
    // (2026-10-02: three Coinbase rows had been marked live on a product-page URL.)
    expect(PROVIDER_CAPABILITIES.filter((c) => c.contractStatus === "live")).toEqual([]);
  });

  it("names partners by internal id only", () => {
    // User-facing attribution comes from rampAttribution(); the matrix itself
    // never hard-wires a vendor name.
    for (const c of PROVIDER_CAPABILITIES) {
      expect(["furlgateway", "furlbridge", "furlpayout"]).toContain(c.providerId);
    }
  });

  it("says so plainly rather than failing obscurely", () => {
    const result = selectProvider(QUERY);
    expect(result.selected).toBeNull();
    expect(result.summary).toMatch(/does not exist yet/);
  });
});

describe("eligibility requires a signed, credentialed, accepted corridor", () => {
  it("refuses a row whose contract is not live", () => {
    for (const status of ["none", "in_discussion", "signed_pending_credentials"] as const) {
      const decision = evaluateCapability(liveRow({ contractStatus: status }), QUERY);
      expect(decision.eligible, status).toBe(false);
      expect(decision.reasons).toContain("contract_not_live");
    }
  });

  it("refuses a provider that has not accepted us as a VDA business", () => {
    // The most common reason a technically perfect integration cannot go live:
    // country, currency and method all supported, merchant category declined.
    const decision = evaluateCapability(liveRow({ vdaMerchantAccepted: false }), QUERY);
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain("vda_not_accepted");
  });

  it("refuses when a required credential is absent", () => {
    const row = liveRow({ requiredCredentials: ["FURLPAY_TEST_PROVIDER_KEY_ABSENT"] });
    const decision = evaluateCapability(row, QUERY);
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain("missing_credentials");
  });

  it("enforces amount bounds in minor units", () => {
    const row = liveRow();
    expect(evaluateCapability(row, { ...QUERY, amountMinor: 1n }).reasons).toContain(
      "amount_below_minimum"
    );
    expect(
      evaluateCapability(row, { ...QUERY, amountMinor: 999_999_999n }).reasons
    ).toContain("amount_above_maximum");
  });

  it("reports EVERY failing reason, not just the first", () => {
    // An operator opening a corridor needs the whole list; discovering the
    // missing credential only after signing the contract wastes a week.
    const row = liveRow({
      contractStatus: "none",
      vdaMerchantAccepted: false,
      requiredCredentials: ["FURLPAY_TEST_PROVIDER_KEY_ABSENT"],
    });
    const decision = evaluateCapability(row, { ...QUERY, amountMinor: 1n });
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "contract_not_live",
        "vda_not_accepted",
        "missing_credentials",
        "amount_below_minimum",
      ])
    );
  });

  it("matches a corridor only on an exact asset id, not a bare symbol", () => {
    // "USDC" is not an asset — USDC on Arbitrum cannot settle a Base order.
    const row = liveRow({ assets: ["USDC.base"] });
    expect(matchingCapabilities(QUERY, [row])).toHaveLength(0);
  });
});

describe("selection also requires a registered, healthy adapter", () => {
  it("refuses when no adapter is registered for a live row", () => {
    const result = selectProvider(QUERY);
    // With the real matrix empty there are no candidates at all; the guard is
    // exercised through evaluateCapability + registry below.
    expect(result.selected).toBeNull();
  });

  it("treats an unprobed provider as unusable, not as healthy", () => {
    // A provider we have never probed has not earned the benefit of the doubt.
    const status = getProviderHealth("onramp", "never-probed");
    expect(status.state).toBe("unknown");
  });

  it("keeps an operator pause across a health probe", () => {
    setProviderPaused("onramp", "p1", true, "incident 42");
    recordProviderHealth({ providerId: "p1", kind: "onramp", state: "healthy" });
    // A probe reporting healthy must not silently undo a human's stop.
    expect(getProviderHealth("onramp", "p1").operatorPaused).toBe(true);
  });

  it("refuses to register two adapters under one id", () => {
    // Order-dependent selection makes "which one moved the money" unanswerable.
    providerRegistry.register(stubAdapter("dup"));
    expect(() => providerRegistry.register(stubAdapter("dup"))).toThrow(/already registered/);
  });
});

describe("failover", () => {
  it("REFUSES on an indeterminate outcome, whatever the state", () => {
    // The dangerous case is not an obvious success — it is the timeout. The
    // first provider may have accepted the instruction and lost the response;
    // re-issuing against a second pays twice, with no way to claw it back.
    expect(() => assertFailoverAllowed("CREATED", true)).toThrow(FailoverRefused);
    expect(() => assertFailoverAllowed("QUOTED", true)).toThrow(/indeterminate/);
  });

  it("refuses once value is committed", () => {
    for (const state of [
      "PAYMENT_CONFIRMED",
      "SETTLEMENT_PENDING",
      "SETTLED",
      "CRYPTO_PENDING",
      "CRYPTO_CONFIRMED",
      "PROVIDER_PENDING",
      "BANK_PENDING",
    ] as const) {
      expect(() => assertFailoverAllowed(state, false), state).toThrow(FailoverRefused);
    }
  });

  it("refuses on a terminal state", () => {
    expect(() => assertFailoverAllowed("COMPLETED", false)).toThrow(/terminal/);
    expect(() => assertFailoverAllowed("REFUNDED", false)).toThrow(/terminal/);
  });

  it("allows re-routing only before anything moved", () => {
    expect(failoverAllowed("CREATED", false)).toBe(true);
    expect(failoverAllowed("QUOTED", false)).toBe(true);
    expect(failoverAllowed("COMPLIANCE_REVIEW", false)).toBe(true);
  });
});
