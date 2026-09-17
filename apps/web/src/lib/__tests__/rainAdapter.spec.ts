import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  RAIN_API_URL_DEVELOPMENT,
  RAIN_API_URL_PRODUCTION,
  RAIN_AUTH_HEADER,
  RAIN_PATHS,
  RainNotConfiguredError,
  createRainAdapter,
  fromRainStatus,
  mapRainCard,
  toRainFrequency,
  toRainStatus,
  rainAdapter,
  rainBaseUrl,
  rainCredentialsPresent,
} from "../cards/rainAdapter";
import { cardIssuingLive, cardSimulationAllowed } from "../cardIssuer";

// ---------------------------------------------------------------------------
// The Rain adapter's contract is REFUSAL, and that is what these tests pin.
//
// Rain's API reference is behind a partner login, so the request/response
// schema and the webhook signature scheme are not knowable from outside. The
// adapter therefore throws rather than sending a guessed payload. A card
// adapter that guesses a field name fails at the counter with the network
// holding the line; one that guesses a signature scheme accepts any caller.
//
// The verified facts — base URLs, auth header, endpoint paths — are pinned too,
// because they were read from Rain's public SDK rather than from a report, and
// a later "correction" back to a plausible-but-wrong value should fail here.
// ---------------------------------------------------------------------------

const ENV_KEYS = ["RAIN_API_KEY", "RAIN_WEBHOOK_SECRET", "RAIN_API_URL", "FURLPAY_ENV"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("verified Rain API facts", () => {
  it("matches the servers block of Rain's OpenAPI document", () => {
    // Issuing API v1.3.0 declares exactly these two servers. api.rain.xyz
    // returns 404 — a guide that says otherwise describes a host that does not
    // serve this API.
    expect(RAIN_API_URL_PRODUCTION).toBe("https://api.raincards.xyz/v1");
    expect(RAIN_API_URL_DEVELOPMENT).toBe("https://api-dev.raincards.xyz/v1");
    expect(RAIN_API_URL_PRODUCTION).not.toContain("api.rain.xyz");
  });

  it("keeps /issuing in the PATH, not the base URL", () => {
    // Rain exposes payments, transfers, quotes and rewards directly under /v1.
    // Folding /issuing into the base would misroute every one of them.
    expect(RAIN_API_URL_PRODUCTION).not.toContain("/issuing");
    expect(RAIN_PATHS.listCards).toBe("/issuing/cards");
    expect(RAIN_PATHS.card("card_1")).toBe("/issuing/cards/card_1");
  });

  it("authenticates with an Api-Key header, not a bearer token", () => {
    expect(RAIN_AUTH_HEADER).toBe("Api-Key");
  });

  it("has no /cardholders, /freeze or /reveal-token path", () => {
    // All three appear in circulating integration write-ups. None exists.
    // Cardholders are /users; status changes are PATCH /cards/{id}; card
    // credentials are /cards/{id}/secrets.
    const paths = JSON.stringify(RAIN_PATHS) + RAIN_PATHS.card("x") + RAIN_PATHS.cardSecrets("x");
    expect(paths).not.toContain("cardholders");
    expect(paths).not.toContain("freeze");
    expect(paths).not.toContain("reveal-token");
    expect(RAIN_PATHS.cardSecrets("card_1")).toBe("/issuing/cards/card_1/secrets");
    expect(RAIN_PATHS.userCards("user_1")).toBe("/issuing/users/user_1/cards");
  });

  it("encodes path parameters", () => {
    expect(RAIN_PATHS.card("a/b")).toBe("/issuing/cards/a%2Fb");
  });
});

describe("base URL resolution", () => {
  it("defaults to the development host outside production", () => {
    expect(rainBaseUrl()).toBe(RAIN_API_URL_DEVELOPMENT);
  });

  it("uses production only when FURLPAY_ENV says so", () => {
    process.env.FURLPAY_ENV = "production";
    expect(rainBaseUrl()).toBe(RAIN_API_URL_PRODUCTION);
  });

  it("honours an explicit override and strips a trailing slash", () => {
    process.env.RAIN_API_URL = "https://example.test/v1/issuing/";
    expect(rainBaseUrl()).toBe("https://example.test/v1/issuing");
  });
});

describe("credential gating", () => {
  it("requires BOTH the api key and the webhook secret", () => {
    expect(rainCredentialsPresent()).toBe(false);
    process.env.RAIN_API_KEY = "k";
    expect(rainCredentialsPresent()).toBe(false);
    process.env.RAIN_WEBHOOK_SECRET = "s";
    expect(rainCredentialsPresent()).toBe(true);
  });

  it("treats whitespace as absent", () => {
    process.env.RAIN_API_KEY = "   ";
    process.env.RAIN_WEBHOOK_SECRET = "s";
    expect(rainCredentialsPresent()).toBe(false);
  });

  it("rainAdapter() returns null when unconfigured, so callers fail closed", () => {
    expect(rainAdapter()).toBeNull();
  });

  it("rainAdapter() returns an adapter once configured", () => {
    process.env.RAIN_API_KEY = "k";
    process.env.RAIN_WEBHOOK_SECRET = "s";
    const a = rainAdapter();
    expect(a).not.toBeNull();
    expect(a?.id).toBe("rain");
    expect(a?.kind).toBe("issuing");
  });
});

describe("vocabulary mapping matches Rain's real enums", () => {
  it("maps our status to Rain's — frozen is 'locked', not 'frozen'", () => {
    expect(toRainStatus("frozen")).toBe("locked");
    expect(toRainStatus("closed")).toBe("canceled");
    expect(toRainStatus("pending")).toBe("notActivated");
    expect(toRainStatus("active")).toBe("active");
  });

  it("maps Rain's status back to ours", () => {
    expect(fromRainStatus("locked")).toBe("frozen");
    expect(fromRainStatus("canceled")).toBe("closed");
    expect(fromRainStatus("notActivated")).toBe("pending");
  });

  it("treats an unknown issuer status as frozen, never active", () => {
    // A card whose state we do not understand must not read as spendable.
    expect(fromRainStatus("someFutureState")).toBe("frozen");
  });

  it("maps limit windows to Rain's frequencies", () => {
    expect(toRainFrequency("daily", false)).toBe("per24HourPeriod");
    expect(toRainFrequency("weekly", false)).toBe("per7DayPeriod");
    expect(toRainFrequency("monthly", false)).toBe("per30DayPeriod");
    expect(toRainFrequency("transaction", false)).toBe("perAuthorization");
  });

  it("single-use forces perAuthorization whatever the window says", () => {
    // The travel VCN case: a single-use card must not inherit a monthly window.
    expect(toRainFrequency("monthly", true)).toBe("perAuthorization");
  });
});

describe("mapRainCard", () => {
  const base = {
    id: "card_1",
    userId: "u1",
    status: "active",
    expirationMonth: "07",
    expirationYear: "2029",
    last4: "4242",
  };

  it("maps a well-formed card", () => {
    const c = mapRainCard({ ...base });
    expect(c.providerCardRef).toBe("card_1");
    expect(c.status).toBe("active");
    expect(c.expMonth).toBe(7);
    expect(c.expYear).toBe(2029);
    expect(c.last4).toBe("4242");
  });

  it("never fabricates a last4", () => {
    // A plausible-looking wrong last4 makes a support call unresolvable.
    const c = mapRainCard({ ...base, last4: undefined });
    expect(c.last4).toBe("");
  });

  it("rejects an impossible expiry rather than defaulting", () => {
    expect(() => mapRainCard({ ...base, expirationMonth: "13" })).toThrow();
    expect(() => mapRainCard({ ...base, expirationMonth: "abc" })).toThrow();
  });
});

describe("what still refuses, and why", () => {
  const adapter = createRainAdapter();
  const authRequest = {
    providerAuthRef: "auth_1",
    providerCardRef: "card_1",
    amount: { minor: 2500n } as never,
    merchant: { name: "Hotel", mcc: "7011" },
  };

  it("parseAuthorizationRequest refuses, naming the signature gap", async () => {
    // The most important refusal in the file. An adapter that "verified" an
    // invented signature scheme would approve spend for any caller who can
    // reach the endpoint.
    await expect(adapter.parseAuthorizationRequest("{}", {})).rejects.toThrow(/signature scheme is not public/i);
  });

  it("encodeAuthorizationDecision refuses", () => {
    expect(() => adapter.encodeAuthorizationDecision(authRequest as never, { approve: true })).toThrow(
      RainNotConfiguredError
    );
  });

  it("refuses to issue a card carrying MCC limits it cannot enforce", async () => {
    // Rain's card-creation schema has no MCC field. Dropping the restriction
    // silently would issue a card that spends anywhere.
    await expect(
      adapter.issueCard({
        holderRef: "u1",
        formFactor: "virtual",
        currency: "USD",
        controls: { allowedMccs: ["7011"] },
        singleUse: true,
      })
    ).rejects.toThrow(/MCC/i);
  });

  it("refuses to reach the API with no key rather than sending an anonymous request", async () => {
    await expect(adapter.getCard("card_1")).rejects.toThrow(/RAIN_API_KEY is not set/i);
  });
});

describe("credentials alone cannot switch card issuing on", () => {
  it("stays off even with both Rain secrets set", () => {
    // lib/cardIssuer.ts checks the flag's `unimplemented` reason BEFORE
    // `enabled`, so provisioning env vars does not flip the gate. That ordering
    // is the safety property: the day someone deletes the reason, they must
    // actually have an issuer. Circulating integration guides propose
    // `return Boolean(process.env.RAIN_API_KEY) && ...` — this test exists so
    // that change fails loudly rather than shipping.
    process.env.RAIN_API_KEY = "k";
    process.env.RAIN_WEBHOOK_SECRET = "s";
    expect(cardIssuingLive()).toBe(false);
  });

  it("does not enable the simulator in production either", () => {
    expect(typeof cardSimulationAllowed()).toBe("boolean");
  });
});
