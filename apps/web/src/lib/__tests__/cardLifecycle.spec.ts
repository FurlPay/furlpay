import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetCardLifecycleForTests,
  __activationCodeForTests,
  orderCard,
  getLifecycle,
  listLifecycles,
  adoptExistingCard,
  markShipped,
  updateShipping,
  activateCard,
  setPin,
  verifyPin,
  isWeakPin,
  reportLost,
  closeCard,
  reissueCard,
  setTheme,
  setProvisioning,
  mintRevealGrant,
  consumeRevealGrant,
  lifecycleView,
  availableProducts,
  CARD_LIMITS,
} from "@/lib/services/cardLifecycle";
import type { PaymentCard } from "@/lib/types";

// A card is a bearer instrument. These specs pin the rules that decide who can
// bring one into service, who can take it out, and what survives when it is
// compromised.

const U = "user-cardholder";

const ADDRESS = {
  name: "A Kumar",
  line1: "1 Example Street",
  city: "Amsterdam",
  postcode: "1011AA",
  country: "NL",
};

const OK = { tier: "Ultra" as const, kycVerified: true, existingCards: 0 };

function virtual() {
  return orderCard(U, { productId: "virtual-standard", label: "Daily" }, OK);
}

function physical() {
  return orderCard(U, { productId: "physical-metal", label: "Metal", shipping: ADDRESS }, OK);
}

beforeEach(() => {
  __resetCardLifecycleForTests();
});

describe("ordering", () => {
  it("issues a virtual card live and unfrozen", () => {
    const { lifecycle, card, feeUsd } = virtual();
    expect(lifecycle.status).toBe("active");
    expect(card.frozen).toBe(false);
    expect(feeUsd).toBe(0);
  });

  it("issues a physical card FROZEN until it is activated", () => {
    const { lifecycle, card } = physical();
    expect(lifecycle.status).toBe("ordered");
    // A card intercepted in the post must not work out of the envelope.
    expect(card.frozen).toBe(true);
    expect(lifecycle.activatedAt).toBeNull();
  });

  it("refuses to issue to an unverified identity", () => {
    expect(() => orderCard(U, { productId: "virtual-standard", label: "x" }, { ...OK, kycVerified: false })).toThrow(
      /verification required/,
    );
  });

  it("enforces the plan gate on premium products", () => {
    expect(() =>
      orderCard(U, { productId: "physical-metal", label: "x", shipping: ADDRESS }, { ...OK, tier: "Standard" }),
    ).toThrow(/requires the Pro plan/);
  });

  it("enforces the plan gate on premium designs", () => {
    expect(() =>
      orderCard(U, { productId: "virtual-standard", label: "x", themeId: "aurora" }, { ...OK, tier: "Standard" }),
    ).toThrow(/Pro and above/);
  });

  it("requires an address for anything that ships", () => {
    expect(() => orderCard(U, { productId: "physical-core", label: "x" }, OK)).toThrow(/shipping address/);
  });

  it("enforces the per-account card limit", () => {
    expect(() =>
      orderCard(U, { productId: "virtual-standard", label: "x" }, { ...OK, existingCards: CARD_LIMITS.maxCardsPerUser }),
    ).toThrow(/limit reached/);
  });

  it("reports why each unavailable product is unavailable", () => {
    const products = availableProducts("Standard", false, 0);
    const metal = products.find((p) => p.id === "physical-metal")!;
    expect(metal.available).toBe(false);
    expect(metal.reasons).toEqual(expect.arrayContaining(["kyc_required", "tier_required"]));
  });

  it("hides one user's cards from another", () => {
    const { card } = virtual();
    expect(() => getLifecycle(card.id, "someone-else")).toThrow(/not found/);
    expect(listLifecycles("someone-else")).toHaveLength(0);
  });
});

describe("activation", () => {
  it("needs the code printed on the carrier", () => {
    const { card } = physical();
    markShipped(card.id, "TRACK1");
    const code = __activationCodeForTests(card.id)!;

    expect(() => activateCard(card.id, U, "00000000")).toThrow(/Incorrect/);
    const lc = activateCard(card.id, U, code);
    expect(lc.status).toBe("active");
    expect(lc.activatedAt).not.toBeNull();
  });

  it("destroys the code once it has been used", () => {
    const { card } = physical();
    const code = __activationCodeForTests(card.id)!;
    activateCard(card.id, U, code);
    expect(__activationCodeForTests(card.id)).toBeNull();
  });

  it("stops accepting attempts after the cap, so the code cannot be walked", () => {
    const { card } = physical();
    for (let i = 0; i < CARD_LIMITS.maxActivationAttempts; i++) {
      expect(() => activateCard(card.id, U, "11111111")).toThrow(/Incorrect/);
    }
    const code = __activationCodeForTests(card.id)!;
    // Even the RIGHT code is refused once the budget is gone — a brute-forced
    // card should not go live at all.
    expect(() => activateCard(card.id, U, code)).toThrow(/Too many failed attempts/);
  });

  it("never activates twice", () => {
    const { card } = physical();
    activateCard(card.id, U, __activationCodeForTests(card.id)!);
    expect(() => activateCard(card.id, U, "00000000")).toThrow(/already active/);
  });

  it("surfaces the remaining attempts, so the UI can warn before lockout", () => {
    const { card } = physical();
    expect(lifecycleView(getLifecycle(card.id, U)).activationAttemptsRemaining).toBe(
      CARD_LIMITS.maxActivationAttempts,
    );
    expect(() => activateCard(card.id, U, "99999999")).toThrow(/Incorrect/);
    expect(lifecycleView(getLifecycle(card.id, U)).activationAttemptsRemaining).toBe(
      CARD_LIMITS.maxActivationAttempts - 1,
    );
  });
});

describe("shipping", () => {
  it("allows an address change only before dispatch", () => {
    const { card } = physical();
    const moved = { ...ADDRESS, city: "Rotterdam" };
    expect(updateShipping(card.id, U, moved).shipping?.city).toBe("Rotterdam");

    markShipped(card.id, "TRACK1");
    expect(() => updateShipping(card.id, U, ADDRESS)).toThrow(/already been dispatched/);
  });
});

describe("PIN", () => {
  it("rejects predictable PINs", () => {
    expect(isWeakPin("0000")).toBe(true);
    expect(isWeakPin("1234")).toBe(true);
    expect(isWeakPin("9876")).toBe(true);
    expect(isWeakPin("4071")).toBe(false);

    const { card } = virtual();
    expect(() => setPin(card.id, U, "1111")).toThrow(/less predictable/);
  });

  it("never exposes the PIN in any view", () => {
    const { card } = virtual();
    setPin(card.id, U, "4071");
    const view = lifecycleView(getLifecycle(card.id, U));
    expect(view.hasPin).toBe(true);
    expect(JSON.stringify(view)).not.toContain("4071");
    // Nor the material it is derived from.
    expect(JSON.stringify(view)).not.toContain("salt");
  });

  it("verifies a correct PIN and resets the counter", () => {
    const { card } = virtual();
    setPin(card.id, U, "4071");
    verifyPin(card.id, U, "0000");
    const ok = verifyPin(card.id, U, "4071");
    expect(ok.ok).toBe(true);
    expect(ok.attemptsRemaining).toBe(CARD_LIMITS.maxPinAttempts);
  });

  it("locks after the attempt cap and refuses even the right PIN while locked", () => {
    const { card } = virtual();
    setPin(card.id, U, "4071");

    for (let i = 0; i < CARD_LIMITS.maxPinAttempts - 1; i++) {
      expect(verifyPin(card.id, U, "0000").ok).toBe(false);
    }
    const locked = verifyPin(card.id, U, "0000");
    expect(locked.ok).toBe(false);
    expect(locked.lockedUntil).not.toBeNull();

    expect(verifyPin(card.id, U, "4071").ok).toBe(false);
  });

  it("gives a fresh set of attempts once the lock expires", () => {
    const { card } = virtual();
    setPin(card.id, U, "4071");
    for (let i = 0; i < CARD_LIMITS.maxPinAttempts; i++) verifyPin(card.id, U, "0000");

    const later = new Date(Date.now() + (CARD_LIMITS.pinLockMinutes + 1) * 60_000);
    expect(verifyPin(card.id, U, "4071", later).ok).toBe(true);
  });

  it("refuses to set a PIN on a dead card", () => {
    const { card } = virtual();
    reportLost(card.id, U);
    expect(() => setPin(card.id, U, "4071")).toThrow(/lost/);
  });
});

describe("loss is terminal", () => {
  it("destroys the PIN and provisioning when a card is reported lost", () => {
    const { card } = virtual();
    setPin(card.id, U, "4071");
    setProvisioning(card.id, U, "applePay", true);

    const lc = reportLost(card.id, U);
    expect(lc.status).toBe("lost");
    expect(lc.pin).toBeNull();
    expect(lc.provisioning).toEqual({ googlePay: false, applePay: false });
  });

  it("cannot be reported twice, closed, or re-provisioned", () => {
    const { card } = virtual();
    reportLost(card.id, U);
    expect(() => reportLost(card.id, U)).toThrow(/already reported lost/);
    expect(() => closeCard(card.id, U)).toThrow(/lost/);
    expect(() => setProvisioning(card.id, U, "applePay", true)).toThrow(/lost/);
    expect(() => setTheme(card.id, U, "sand", "Ultra")).toThrow(/lost/);
  });

  it("keeps `lost` as the status even after a reissue supersedes it", () => {
    const { card } = virtual();
    reportLost(card.id, U);
    const { previous } = reissueCard(card.id, U, { label: "Replacement" });
    // Relabelling it "reissued" would erase why it left service.
    expect(previous.status).toBe("lost");
    expect(previous.closeReason).toBe("reported_lost");
  });
});

describe("reissue", () => {
  it("mints a new card with a new number and no PIN", () => {
    const { card } = virtual();
    setPin(card.id, U, "4071");
    const result = reissueCard(card.id, U, { label: "Replacement" });

    expect(result.card.id).not.toBe(card.id);
    expect(result.card.last4).toBeTruthy();
    // The compromised card's PIN must not keep working on the replacement.
    expect(result.lifecycle.pin).toBeNull();
    expect(result.previous.pin).toBeNull();
  });

  it("links the chain in both directions", () => {
    const { card } = virtual();
    const result = reissueCard(card.id, U, { label: "Replacement" });
    expect(result.previous.replacedByCardId).toBe(result.lifecycle.cardId);
    expect(result.lifecycle.replacesCardId).toBe(card.id);
  });

  it("marks an ordinary reissue as closed, not lost", () => {
    const { card } = virtual();
    const { previous } = reissueCard(card.id, U, { label: "Replacement" });
    expect(previous.status).toBe("closed");
    expect(previous.closeReason).toBe("reissued");
  });

  it("refuses to replace the same card twice", () => {
    const { card } = virtual();
    reissueCard(card.id, U, { label: "One" });
    expect(() => reissueCard(card.id, U, { label: "Two" })).toThrow(/already been replaced/);
  });

  it("carries the old address forward when none is given", () => {
    const { card } = physical();
    const result = reissueCard(card.id, U, { label: "Replacement" });
    expect(result.lifecycle.shipping?.city).toBe("Amsterdam");
    expect(result.lifecycle.status).toBe("ordered");
  });
});

describe("wallet provisioning", () => {
  it("refuses to add an un-activated card to a wallet", () => {
    const { card } = physical();
    expect(() => setProvisioning(card.id, U, "googlePay", true)).toThrow(/ordered/);
  });

  it("always allows removal, so a customer can clean up", () => {
    const { card } = virtual();
    setProvisioning(card.id, U, "googlePay", true);
    closeCard(card.id, U);
    expect(setProvisioning(card.id, U, "googlePay", false).provisioning.googlePay).toBe(false);
  });
});

describe("detail reveal", () => {
  it("mints a single-use grant that carries no card data", () => {
    const { card } = virtual();
    const grant = mintRevealGrant(card.id, U);
    // The PAN lives in the PCI vault; this is only the permit to ask for it.
    expect(JSON.stringify(grant)).not.toContain(card.last4);
    expect(grant.usedAt).toBeNull();

    consumeRevealGrant(grant.token, U);
    expect(() => consumeRevealGrant(grant.token, U)).toThrow(/already used/);
  });

  it("expires", () => {
    const { card } = virtual();
    const grant = mintRevealGrant(card.id, U);
    const later = new Date(Date.now() + (CARD_LIMITS.revealGrantTtlSeconds + 1) * 1000);
    expect(() => consumeRevealGrant(grant.token, U, later)).toThrow(/expired/);
  });

  it("cannot be consumed by a different user", () => {
    const { card } = virtual();
    const grant = mintRevealGrant(card.id, U);
    expect(() => consumeRevealGrant(grant.token, "someone-else")).toThrow(/not found/);
  });

  it("refuses to reveal a card that is not active", () => {
    const { card } = physical();
    expect(() => mintRevealGrant(card.id, U)).toThrow(/ordered/);
  });
});

describe("adopting pre-existing cards", () => {
  it("gives a card that predates this module an active lifecycle", () => {
    const legacy = {
      id: "card_legacy",
      kind: "virtual",
      label: "Old",
      last4: "4242",
      network: "Visa",
      frozen: false,
      gradient: ["#000", "#111"],
      limits: { perPurchase: 100, daily: 100, dailySpent: 0 },
      channels: { online: true, offline: true, atm: false },
      settlementCurrency: "USD",
    } as PaymentCard;

    const lc = adoptExistingCard(U, legacy);
    expect(lc.status).toBe("active");
    // Adopting twice must not reset it.
    expect(adoptExistingCard(U, legacy).orderedAt).toBe(lc.orderedAt);
  });
});
