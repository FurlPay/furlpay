import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  FURLPAY_TRAVEL_MCCS,
  RAIN_BLOCKED_MCCS,
  RAIN_BLOCKED_MERCHANTS_OF_NOTE,
  VISA_POS_MAX_MINOR,
  VISA_PREPAID_POS_MAX_MINOR,
  rainWillDecline,
  unusableMccs,
} from "../cards/rainRestrictions";
import {
  RAIN_EGRESS_IPS_PRODUCTION,
  RAIN_EGRESS_IPS_SANDBOX,
  checkRainSourceIp,
  clientIpFrom,
  rainEgressIps,
  rainSessionIdPublicKey,
} from "../cards/rainNetwork";

// ---------------------------------------------------------------------------
// The issuer's restrictions are not ours, and two of them collide with products
// this repo already ships. These tests exist to make the collisions loud.
// ---------------------------------------------------------------------------

describe("the travel collision", () => {
  it("does not block the MCCs the travel VCN locks to", () => {
    // 7011 lodging, 4511 airlines, 7512 car rental — all fine.
    for (const mcc of FURLPAY_TRAVEL_MCCS) {
      expect(rainWillDecline(mcc).blocked, `${mcc} should be usable`).toBe(false);
    }
  });

  it("DOES block 5962 — the category an OTA often bills as", () => {
    // The finding worth carrying: "Direct Marketing — Travel Related
    // Arrangement Services" is declined by default. A travel card locked to
    // 7011 that meets a booking platform billing as 5962 fails twice: our lock
    // rejects it, and the issuer would have declined it anyway.
    const verdict = rainWillDecline("5962");
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toMatch(/Travel Related Arrangement/i);
  });
});

describe("the investing and crypto collisions", () => {
  it("blocks securities brokers, so card-funded brokerage is not on this rail", () => {
    expect(rainWillDecline("6211").blocked).toBe(true);
  });

  it("blocks quasi-cash and funding categories used by crypto purchase", () => {
    for (const mcc of ["6051", "6050", "6540", "6010", "6011", "6012"]) {
      expect(rainWillDecline(mcc).blocked, `${mcc} should be blocked`).toBe(true);
    }
  });

  it("names Wise among blocked merchants", () => {
    // FurlPay's own off-ramp is described as going over "Wise rails". Different
    // direction of money movement, so not a contradiction — but it reads as a
    // bug at 2am unless it is written down.
    expect(RAIN_BLOCKED_MERCHANTS_OF_NOTE).toContain("Wise");
  });
});

describe("rainWillDecline", () => {
  it("tolerates whitespace around a code", () => {
    expect(rainWillDecline(" 7995 ").blocked).toBe(true);
  });

  it("returns a reason a support agent can repeat", () => {
    expect(rainWillDecline("7995").reason).toMatch(/Gambling/i);
  });

  it("does not claim approval for an unblocked code", () => {
    // The published list is not the whole story: Rain also runs an unpublished
    // dynamic blocklist. false means "no rule we can see", never "approved".
    expect(rainWillDecline("5812").blocked).toBe(false);
  });

  it("covers the whole published list", () => {
    expect(Object.keys(RAIN_BLOCKED_MCCS).length).toBeGreaterThanOrEqual(58);
    for (const mcc of Object.keys(RAIN_BLOCKED_MCCS)) {
      expect(rainWillDecline(mcc).blocked).toBe(true);
    }
  });
});

describe("unusableMccs", () => {
  it("catches a card that would be issued unable to transact anywhere", () => {
    // A card restricted entirely to blocked categories is a card that cannot
    // be used — which looks, to everyone, like the card is broken.
    expect(unusableMccs(["5962", "7995"])).toEqual(["5962", "7995"]);
  });

  it("returns only the unusable entries from a mixed list", () => {
    expect(unusableMccs(["7011", "5962", "4511"])).toEqual(["5962"]);
  });

  it("is empty for a usable travel lock", () => {
    expect(unusableMccs([...FURLPAY_TRAVEL_MCCS])).toEqual([]);
  });
});

describe("Visa network ceilings", () => {
  it("records the per-product POS maxima in minor units", () => {
    // $749,999.99 etc. Network ceilings, not our limits — a configured spend
    // limit above these is unreachable and therefore a config error.
    expect(VISA_POS_MAX_MINOR["Visa Signature"]).toBe(74_999_999);
    expect(VISA_POS_MAX_MINOR["Visa Infinite"]).toBe(99_999_999);
    expect(VISA_PREPAID_POS_MAX_MINOR).toBe(9_999_999);
  });

  it("keeps prepaid well below credit on every product", () => {
    for (const max of Object.values(VISA_POS_MAX_MINOR)) {
      expect(VISA_PREPAID_POS_MAX_MINOR).toBeLessThan(max);
    }
  });
});

describe("webhook source IP", () => {
  const saved = process.env.FURLPAY_ENV;
  const savedEnforce = process.env.RAIN_ENFORCE_SOURCE_IP;
  beforeEach(() => {
    delete process.env.FURLPAY_ENV;
    delete process.env.RAIN_ENFORCE_SOURCE_IP;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.FURLPAY_ENV;
    else process.env.FURLPAY_ENV = saved;
    if (savedEnforce === undefined) delete process.env.RAIN_ENFORCE_SOURCE_IP;
    else process.env.RAIN_ENFORCE_SOURCE_IP = savedEnforce;
  });

  it("uses sandbox addresses outside production", () => {
    expect(rainEgressIps()).toEqual(RAIN_EGRESS_IPS_SANDBOX);
    process.env.FURLPAY_ENV = "production";
    expect(rainEgressIps()).toEqual(RAIN_EGRESS_IPS_PRODUCTION);
  });

  it("recognises a published sandbox address", () => {
    expect(checkRainSourceIp({ "x-forwarded-for": "34.66.230.233" }).recognised).toBe(true);
  });

  it("takes the first hop of a forwarded chain", () => {
    expect(clientIpFrom({ "x-forwarded-for": "34.66.230.233, 10.0.0.1" })).toBe("34.66.230.233");
  });

  it("does not recognise a production address in sandbox", () => {
    // Using the wrong environment's list is a real misconfiguration, not a
    // near-miss to be tolerated.
    expect(checkRainSourceIp({ "x-forwarded-for": "34.67.3.60" }).recognised).toBe(false);
  });

  it("fails OPEN by default, and says so in the verdict", () => {
    // Rain adds egress IPs without notice. An unknown source must not take card
    // authorisation down — the SIGNATURE is the control that refuses.
    const v = checkRainSourceIp({ "x-forwarded-for": "8.8.8.8" });
    expect(v.recognised).toBe(false);
    if (!v.recognised) {
      expect(v.enforced).toBe(false);
      expect(v.observed).toBe("8.8.8.8");
    }
  });

  it("reports enforcement when it is switched on", () => {
    process.env.RAIN_ENFORCE_SOURCE_IP = "1";
    const v = checkRainSourceIp({ "x-forwarded-for": "8.8.8.8" });
    if (!v.recognised) expect(v.enforced).toBe(true);
  });

  it("handles a missing header without throwing", () => {
    const v = checkRainSourceIp({});
    expect(v.recognised).toBe(false);
    if (!v.recognised) expect(v.observed).toBeNull();
  });
});

describe("SessionId public keys", () => {
  const saved = process.env.FURLPAY_ENV;
  afterEach(() => {
    if (saved === undefined) delete process.env.FURLPAY_ENV;
    else process.env.FURLPAY_ENV = saved;
  });

  it("selects by environment rather than leaving it to a caller", () => {
    delete process.env.FURLPAY_ENV;
    const sandbox = rainSessionIdPublicKey();
    process.env.FURLPAY_ENV = "production";
    const production = rainSessionIdPublicKey();

    expect(sandbox).not.toBe(production);
    for (const key of [sandbox, production]) {
      expect(key.startsWith("-----BEGIN PUBLIC KEY-----")).toBe(true);
      expect(key.trimEnd().endsWith("-----END PUBLIC KEY-----")).toBe(true);
    }
  });
});

describe("issuance refuses a card that could never transact", () => {
  it("names the blocked categories rather than failing generically", async () => {
    const { createRainAdapter } = await import("../cards/rainAdapter");
    await expect(
      createRainAdapter().issueCard({
        holderRef: "u1",
        formFactor: "virtual",
        currency: "USD",
        controls: { allowedMccs: ["5962"] },
        singleUse: true,
      })
    ).rejects.toThrow(/5962/);
  });

  it("still refuses a partially-usable lock, for the separate schema reason", async () => {
    // 7011 is usable, so this is not the "unusable card" case — it falls
    // through to the refusal that exists because Rain's card-creation schema
    // has no published MCC field.
    const { createRainAdapter } = await import("../cards/rainAdapter");
    await expect(
      createRainAdapter().issueCard({
        holderRef: "u1",
        formFactor: "virtual",
        currency: "USD",
        controls: { allowedMccs: ["7011", "5962"] },
        singleUse: true,
      })
    ).rejects.toThrow(/MCC/i);
  });
});
