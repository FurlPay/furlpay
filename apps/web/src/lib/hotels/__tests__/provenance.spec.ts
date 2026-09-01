import { describe, it, expect } from "vitest";
import {
  SOURCE_RANK,
  acceptsUsdc,
  atLeast,
  attributed,
  canHardFilter,
  canRank,
  canStateAsFact,
  derive,
  excludedByUsdcFilter,
  hedge,
  qualifiesForFiveStarBadge,
  unknownAttribute,
  type PaymentCapability,
} from "../provenance";

describe("a value cannot exist without a source", () => {
  it("clamps confidence into range", () => {
    expect(attributed("x", "inferred", 5).confidence).toBe(1);
    expect(attributed("x", "inferred", -2).confidence).toBe(0);
  });

  it("distinguishes unknown from false", () => {
    // The whole file turns on this. "We did not check" is not "no".
    const a = unknownAttribute<boolean>();
    expect(a.value).toBeNull();
    expect(a.value).not.toBe(false);
    expect(canRank(a)).toBe(false);
  });

  it("keeps the source ordering that atLeast depends on", () => {
    // A regression here silently changes what may be shown as fact, so the
    // order is pinned rather than left to whoever edits the array next.
    expect(SOURCE_RANK.indexOf("inferred")).toBeLessThan(SOURCE_RANK.indexOf("derived"));
    expect(SOURCE_RANK.indexOf("provider_reported")).toBeLessThan(
      SOURCE_RANK.indexOf("furlpay_curated")
    );
    expect(SOURCE_RANK[SOURCE_RANK.length - 1]).toBe("furlpay_settlement");
  });
});

describe("what a source permits", () => {
  it("refuses to state an inference as fact, however confident", () => {
    // The luxury-photographs case from the brief: a model at 0.99 is still a
    // model, and confidence is not evidence.
    const guess = attributed(5, "inferred", 0.99);
    expect(canStateAsFact(guess)).toBe(false);
    expect(canRank(guess)).toBe(true); // but it may still order results
  });

  it("lets an inference rank but never hard-filter", () => {
    // Ranking is recoverable, deletion is not: a reader can scroll past a
    // badly-ordered result, but cannot recover one that was removed.
    const guess = attributed("resort", "inferred", 0.8);
    expect(canRank(guess)).toBe(true);
    expect(canHardFilter(guess)).toBe(false);
  });

  it("allows a hard filter only once a human or our own rails checked", () => {
    expect(canHardFilter(attributed("x", "provider_reported", 1))).toBe(false);
    expect(canHardFilter(attributed("x", "furlpay_curated", 0.5))).toBe(true);
    expect(canHardFilter(attributed("x", "furlpay_settlement", 0.5))).toBe(true);
  });

  it("ranks sources monotonically", () => {
    expect(atLeast(attributed(1, "furlpay_settlement", 1), "provider_reported")).toBe(true);
    expect(atLeast(attributed(1, "inferred", 1), "provider_reported")).toBe(false);
  });
});

describe("hedging", () => {
  it("says nothing at all when there is nothing honest to say", () => {
    // Returning null rather than "" so a caller rendering every truthy string
    // cannot leak an unknown as a bare claim.
    expect(hedge(unknownAttribute(), "Has a pool")).toBeNull();
  });

  it("marks an inference as unverified", () => {
    expect(hedge(attributed(true, "inferred", 0.9), "Has a pool")).toBe("Has a pool (not verified)");
  });

  it("states a checked fact plainly", () => {
    expect(hedge(attributed(true, "furlpay_curated", 0.9), "Has a pool")).toBe("Has a pool");
  });
});

describe("derivation cannot launder a guess into a fact", () => {
  it("takes the weakest input's source", () => {
    const good = attributed(10, "provider_authoritative", 1);
    const guess = attributed(2, "inferred", 0.9);
    const out = derive(12, [good, guess], 1);
    expect(out.source).toBe("inferred");
    expect(canStateAsFact(out)).toBe(false);
  });

  it("caps at 'derived' even from the strongest inputs", () => {
    // Our arithmetic could be wrong, so a derivation from settlement data is
    // still a derivation — it must not inherit settlement's authority.
    const a = attributed(1, "furlpay_settlement", 1);
    const b = attributed(2, "furlpay_settlement", 1);
    expect(derive(3, [a, b], 1).source).toBe("derived");
  });

  it("takes the floor of the confidences, not the average", () => {
    const a = attributed(1, "furlpay_curated", 0.9);
    const b = attributed(2, "furlpay_curated", 0.3);
    expect(derive(3, [a, b], 1).confidence).toBeCloseTo(0.3, 6);
  });

  it("returns unknown when derived from nothing", () => {
    expect(derive(5, [], 1).source).toBe("unknown");
  });
});

describe("USDC acceptance — the claim that touches money", () => {
  const cap = (v: PaymentCapability, s: Parameters<typeof attributed>[1]) =>
    attributed<PaymentCapability>(v, s, 1);

  it("accepts only a verified answer from our own settlement layer", () => {
    expect(acceptsUsdc(cap("verified_usdc", "furlpay_settlement"))).toBe(true);
  });

  it("does NOT accept 'FurlPay can settle this' as USDC acceptance", () => {
    // The exact mistake the brief forbids. That FurlPay can complete a booking
    // is a fact about FurlPay's rails, not about the property.
    expect(acceptsUsdc(cap("furlpay_settlement_available", "furlpay_settlement"))).toBe(false);
  });

  it("does NOT accept a card rail as USDC acceptance", () => {
    expect(acceptsUsdc(cap("card_settlement_available", "furlpay_settlement"))).toBe(false);
  });

  it("refuses even a 'verified_usdc' value that did not come from settlement", () => {
    // Guards against a provider feed or a curator asserting USDC support. The
    // only system that can answer this is the one that moves the money.
    expect(acceptsUsdc(cap("verified_usdc", "provider_authoritative"))).toBe(false);
    expect(acceptsUsdc(cap("verified_usdc", "furlpay_curated"))).toBe(false);
    expect(acceptsUsdc(cap("verified_usdc", "inferred"))).toBe(false);
  });

  it("excludes from a USDC filter only what we actually checked", () => {
    // Unchecked properties are surfaced behind a "could not confirm"
    // affordance rather than deleted: absence of a check is not evidence.
    expect(excludedByUsdcFilter(cap("card_settlement_available", "furlpay_settlement"))).toBe(true);
    expect(excludedByUsdcFilter(cap("unknown", "unknown"))).toBe(false);
    expect(excludedByUsdcFilter(cap("verified_usdc", "furlpay_settlement"))).toBe(false);
  });
});

describe("five-star badge", () => {
  it("is refused to an inferred rating", () => {
    // Google's class ratings mix partner data, direct research, hotelier
    // feedback and ML inference, and render all four the same. Ours cannot.
    expect(qualifiesForFiveStarBadge({ stars: attributed(5, "inferred", 0.97) })).toBe(false);
  });

  it("is granted to a rating the provider actually stated", () => {
    expect(qualifiesForFiveStarBadge({ stars: attributed(5, "provider_authoritative", 1) })).toBe(
      true
    );
  });

  it("is refused to a four-star property and to an unrated one", () => {
    expect(qualifiesForFiveStarBadge({ stars: attributed(4, "provider_authoritative", 1) })).toBe(
      false
    );
    expect(qualifiesForFiveStarBadge({ stars: unknownAttribute<number>() })).toBe(false);
  });
});
