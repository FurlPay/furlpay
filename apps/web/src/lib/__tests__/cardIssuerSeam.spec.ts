import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NoCardIssuerError, cardIssuingLive, cardSimulationAllowed, getCardIssuer } from "../cardIssuer";
import { createSimulatedCardIssuerAdapter, resetSimulatedCards } from "../cards/simulatedAdapter";

// ---------------------------------------------------------------------------
// One seam, and what it refuses.
//
// Every card route resolves its issuer through getCardIssuer(), so this is the
// single place that decides between a real issuer, the simulator, and nobody.
// The property worth protecting is the LAST of those: when no issuer is
// available it throws, rather than quietly returning a simulator whose fixtures
// would then be presented to a user as a card.
// ---------------------------------------------------------------------------

const ENV_KEYS = ["NODE_ENV", "FURLPAY_ENV", "RAIN_API_KEY", "RAIN_WEBHOOK_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  resetSimulatedCards();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  resetSimulatedCards();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("the gate cannot be opened by configuration alone", () => {
  it("stays shut even with both Rain secrets present", () => {
    // CARD_ISSUING_LIVE carries an `unimplemented` reason that flagState()
    // checks BEFORE `enabled`. Circulating integration guides propose replacing
    // that with `Boolean(process.env.RAIN_API_KEY)`; this test makes that change
    // fail loudly rather than ship.
    process.env.RAIN_API_KEY = "k";
    process.env.RAIN_WEBHOOK_SECRET = "s";
    expect(cardIssuingLive()).toBe(false);
  });
});

describe("getCardIssuer", () => {
  it("returns the simulator when simulation is allowed", () => {
    if (!cardSimulationAllowed()) return; // production-like env: covered below
    const issuer = getCardIssuer();
    expect(issuer.kind).toBe("issuing");
    expect(issuer.id).toBe("simulated");
  });

  it("throws rather than inventing an issuer when nothing is available", () => {
    if (cardSimulationAllowed()) return;
    expect(() => getCardIssuer()).toThrow(NoCardIssuerError);
  });

  it("every adapter it can return satisfies the same port", () => {
    // The point of the seam: the simulator and Rain are interchangeable, so the
    // routes are exercised against the shape the real issuer will present.
    const sim = createSimulatedCardIssuerAdapter();
    for (const method of [
      "issueCard",
      "getCard",
      "setCardStatus",
      "getCardSecrets",
      "parseAuthorizationRequest",
      "encodeAuthorizationDecision",
    ] as const) {
      expect(typeof sim[method]).toBe("function");
    }
  });
});

describe("the simulator behaves like an issuer, not like a mock that says yes", () => {
  const issuer = createSimulatedCardIssuerAdapter();

  it("issues a virtual card active and a physical card pending", async () => {
    const virtual = await issuer.issueCard({
      holderRef: "u1",
      formFactor: "virtual",
      currency: "USD",
      controls: {},
      singleUse: true,
    });
    expect(virtual.status).toBe("active");

    const physical = await issuer.issueCard({
      holderRef: "u1",
      formFactor: "physical",
      currency: "USD",
      controls: {},
      singleUse: false,
    });
    // Physical cards arrive inactive in reality; the simulator must not teach
    // the calling code otherwise.
    expect(physical.status).toBe("pending");
  });

  it("refuses an empty MCC allowlist", async () => {
    // [] permits no merchant at all, which is never what a caller means.
    await expect(
      issuer.issueCard({
        holderRef: "u1",
        formFactor: "virtual",
        currency: "USD",
        controls: { allowedMccs: [] },
        singleUse: true,
      })
    ).rejects.toThrow(/permits no merchant/i);
  });

  it("refuses to reopen a closed card", async () => {
    const card = await issuer.issueCard({
      holderRef: "u1",
      formFactor: "virtual",
      currency: "USD",
      controls: {},
      singleUse: false,
    });
    await issuer.setCardStatus(card.providerCardRef, "closed");
    await expect(issuer.setCardStatus(card.providerCardRef, "active")).rejects.toThrow(/cannot be reopened/i);
  });

  it("throws on an unknown card rather than returning one", async () => {
    await expect(issuer.getCard("sim_does_not_exist")).rejects.toThrow(/not found/i);
  });

  it("returns credentials that are obviously fixtures", async () => {
    const card = await issuer.issueCard({
      holderRef: "u1",
      formFactor: "virtual",
      currency: "USD",
      controls: {},
      singleUse: true,
    });
    const secrets = await issuer.getCardSecrets(card.providerCardRef);
    const pan = Buffer.from(secrets.encryptedPan.data, "base64").toString();
    // If this ever reaches a screen or a log it must read as a fixture at a
    // glance, not as a number somebody has to go and verify.
    expect(pan).toContain("furlpay-simulated");
    expect(card.last4).toBe("4242");
    expect(card.providerCardRef.startsWith("sim_")).toBe(true);
  });

  it("parses an authorization into integer minor units", async () => {
    const auth = await issuer.parseAuthorizationRequest(
      JSON.stringify({ id: "a1", cardId: "sim_1", amountMinor: "2500", merchant: { name: "Hotel", mcc: "7011" } }),
      {}
    );
    expect(auth.amount.minor).toBe(2500n);
    expect(auth.merchant.mcc).toBe("7011");
  });

  it("refuses an authorization with no amount rather than defaulting to zero", async () => {
    await expect(issuer.parseAuthorizationRequest(JSON.stringify({ cardId: "sim_1" }), {})).rejects.toThrow(
      /amountMinor is required/i
    );
  });

  it("labels its decisions simulated on the wire", async () => {
    const auth = await issuer.parseAuthorizationRequest(
      JSON.stringify({ id: "a1", cardId: "sim_1", amountMinor: 100 }),
      {}
    );
    const approved = issuer.encodeAuthorizationDecision(auth, { approve: true }) as Record<string, unknown>;
    expect(approved.simulated).toBe(true);
    const declined = issuer.encodeAuthorizationDecision(auth, {
      approve: false,
      reason: "insufficient_funds",
    }) as Record<string, unknown>;
    expect(declined.approved).toBe(false);
    expect(declined.declineReason).toBe("insufficient_funds");
  });
});
