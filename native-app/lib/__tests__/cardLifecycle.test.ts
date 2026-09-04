import {
  blockReasonText,
  canManage,
  isTerminal,
  isWeakPin,
  needsActivation,
  pinError,
  pinLockMinutesRemaining,
  statusPresentation,
  type CardLifecycle,
  type CardStatus,
} from "../cards/lifecycle";

// ---------------------------------------------------------------------------
// Card lifecycle rules.
//
// The state machine lives on the server; what is pinned here is the CLIENT's
// reading of it — which controls a screen offers, which it hides, and what it
// says a status means. Getting this wrong is not cosmetic: offering "Freeze" on
// a card reported lost implies the loss is reversible, and the whole security
// value of that action is that it is not.
//
// `isWeakPin` is duplicated from the server on purpose (so the user is told
// while the field is focused, not after a 400), and duplication is exactly the
// thing that drifts — hence it is tested against the same cases the service's
// own rule describes.
// ---------------------------------------------------------------------------

function lifecycle(over: Partial<CardLifecycle> = {}): CardLifecycle {
  return {
    cardId: "card_1",
    product: { id: "virtual-standard", name: "Virtual", kind: "virtual" },
    status: "active",
    orderedAt: "2026-01-01T00:00:00.000Z",
    shippedAt: null,
    activatedAt: "2026-01-01T00:00:00.000Z",
    closedAt: null,
    closeReason: null,
    hasPin: false,
    pinLockedUntil: null,
    activationAttemptsRemaining: 5,
    shipping: null,
    trackingRef: null,
    theme: { id: "midnight", name: "Midnight", premium: false, gradient: ["#0B1220", "#1E293B"] },
    provisioning: { googlePay: false, applePay: false },
    replacesCardId: null,
    replacedByCardId: null,
    ...over,
  };
}

describe("terminal states", () => {
  it("treats lost and closed as terminal and nothing else", () => {
    const all: CardStatus[] = ["ordered", "shipped", "active", "lost", "closed"];
    const terminal = all.filter(isTerminal);
    expect(terminal).toEqual(["lost", "closed"]);
  });

  it("offers management only on an active card", () => {
    // The screen hides freeze, PIN, design and provisioning off the back of
    // this. A card that cannot transact must not be shown controls that imply
    // it could.
    expect(canManage(lifecycle({ status: "active" }))).toBe(true);
    for (const status of ["ordered", "shipped", "lost", "closed"] as CardStatus[]) {
      expect(canManage(lifecycle({ status }))).toBe(false);
    }
  });

  it("asks for activation only before the card is live", () => {
    expect(needsActivation(lifecycle({ status: "ordered" }))).toBe(true);
    expect(needsActivation(lifecycle({ status: "shipped" }))).toBe(true);
    expect(needsActivation(lifecycle({ status: "active" }))).toBe(false);
    // A lost card is not "not yet activated" — offering an activation field on
    // one would suggest the loss can be walked back.
    expect(needsActivation(lifecycle({ status: "lost" }))).toBe(false);
    expect(needsActivation(lifecycle({ status: "closed" }))).toBe(false);
  });
});

describe("statusPresentation", () => {
  it("gives every status a label and a tone", () => {
    for (const status of ["ordered", "shipped", "active", "lost", "closed"] as CardStatus[]) {
      const p = statusPresentation(lifecycle({ status }));
      expect(p.label.length).toBeGreaterThan(0);
      expect(["good", "warn", "bad", "neutral"]).toContain(p.tone);
    }
  });

  it("marks only a loss as bad", () => {
    expect(statusPresentation(lifecycle({ status: "lost" })).tone).toBe("bad");
    expect(statusPresentation(lifecycle({ status: "active" })).tone).toBe("good");
  });

  it("says a loss is permanent, in the status detail itself", () => {
    // Not only in the confirmation dialog: someone arriving at an already-lost
    // card needs to know why nothing works, without tapping anything.
    const detail = statusPresentation(lifecycle({ status: "lost" })).detail;
    expect(detail).toMatch(/cannot be restored|permanent/i);
  });

  it("distinguishes a card that was replaced from one the customer closed", () => {
    expect(statusPresentation(lifecycle({ status: "closed", closeReason: "reissued" })).label).toBe(
      "Replaced"
    );
    expect(
      statusPresentation(lifecycle({ status: "closed", closeReason: "customer_closed" })).label
    ).toBe("Closed");
  });

  it("tells a physical card holder that it arrives frozen", () => {
    // The single most common support question for a shipped card, answered on
    // the screen rather than in an email.
    const shipped = statusPresentation(
      lifecycle({ status: "shipped", product: { id: "physical-core", name: "Core", kind: "physical" } })
    );
    expect(shipped.detail).toMatch(/frozen/i);
    expect(shipped.detail).toMatch(/code/i);
  });

  it("says nothing extra about an active card", () => {
    expect(statusPresentation(lifecycle({ status: "active" })).detail).toBe("");
  });
});

describe("PIN rules mirror the server", () => {
  it("rejects repeated digits", () => {
    for (const pin of ["0000", "1111", "9999"]) expect(isWeakPin(pin)).toBe(true);
  });

  it("rejects strict runs in both directions", () => {
    expect(isWeakPin("1234")).toBe(true);
    expect(isWeakPin("4321")).toBe(true);
    expect(isWeakPin("6789")).toBe(true);
    expect(isWeakPin("3210")).toBe(true);
  });

  it("accepts an ordinary PIN", () => {
    for (const pin of ["1357", "8042", "9021", "1243"]) expect(isWeakPin(pin)).toBe(false);
  });

  it("does not call a malformed entry weak", () => {
    // Shape and strength are different messages; conflating them tells someone
    // who typed three digits to "pick something harder to guess".
    expect(isWeakPin("12")).toBe(false);
    expect(isWeakPin("abcd")).toBe(false);
    expect(isWeakPin("")).toBe(false);
  });

  it("reports shape problems before strength problems", () => {
    expect(pinError("12")).toMatch(/4 digits/);
    expect(pinError("abcd")).toMatch(/4 digits/);
    expect(pinError("1234")).toMatch(/guess/i);
    expect(pinError("8042")).toBeNull();
  });
});

describe("pinLockMinutesRemaining", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");

  it("is zero when nothing is locked", () => {
    expect(pinLockMinutesRemaining(null, now)).toBe(0);
  });

  it("rounds up, so the user is never told to retry a moment too early", () => {
    expect(pinLockMinutesRemaining("2026-01-01T12:00:30.000Z", now)).toBe(1);
    expect(pinLockMinutesRemaining("2026-01-01T12:14:01.000Z", now)).toBe(15);
  });

  it("is zero once the lock has passed", () => {
    expect(pinLockMinutesRemaining("2026-01-01T11:59:00.000Z", now)).toBe(0);
  });
});

describe("blockReasonText", () => {
  it("explains every refusal the products endpoint can return", () => {
    expect(blockReasonText("kyc_required", "Standard")).toMatch(/identity/i);
    expect(blockReasonText("tier_required", "Pro")).toContain("Pro");
    expect(blockReasonText("card_limit_reached", "Standard")).toMatch(/maximum/i);
  });

  it("names the tier the product actually needs", () => {
    // "Requires an upgrade" is useless; "available on the Ultra plan" is not.
    expect(blockReasonText("tier_required", "Ultra")).toContain("Ultra");
  });
});
