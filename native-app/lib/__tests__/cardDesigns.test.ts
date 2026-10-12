import {
  CARD_DESIGNS,
  CARD_DESIGN_ORDER,
  cardBackFields,
  designFor,
  groupPan,
  parseCardSecrets,
} from "@/lib/cards/designs";

// 4242 4242 4242 4242 is the published Stripe TEST number (passes Luhn). It is
// used here only to exercise the validator; nothing in the app renders it.
const TEST_PAN = "4242424242424242";
const NOW = new Date("2026-10-12T00:00:00Z");

describe("designFor", () => {
  it("recognises the three designs by theme id", () => {
    for (const id of CARD_DESIGN_ORDER) expect(designFor({ themeId: id })).toBe(id);
    expect(designFor({ themeId: "World" })).toBe("world");
  });

  it("recognises them by the gradient the server publishes", () => {
    expect(designFor({ gradient: ["#14197D", "#006BFF"] })).toBe("electric");
    expect(designFor({ gradient: ["#060b21", "#0b2a6b"] })).toBe("world");
    expect(designFor({ gradient: ["#F1F0FF", "#C7A7F8"] })).toBe("pearl");
  });

  it("leaves older themes as plain gradients", () => {
    expect(designFor({ themeId: "midnight", gradient: ["#0B1220", "#1E293B"] })).toBeNull();
    expect(designFor({})).toBeNull();
    expect(designFor({ gradient: null })).toBeNull();
  });

  it("gives every design gradient stops that line up", () => {
    for (const id of CARD_DESIGN_ORDER) {
      const d = CARD_DESIGNS[id];
      if (d.locations) expect(d.locations).toHaveLength(d.colors.length);
      if (d.streaks) {
        expect(d.streaks.locations).toHaveLength(d.streaks.colors.length);
        const sorted = [...d.streaks.locations].sort((a, b) => a - b);
        expect(d.streaks.locations).toEqual(sorted);
      }
    }
  });
});

describe("parseCardSecrets", () => {
  const good = { pan: TEST_PAN, expMonth: 11, expYear: 2028, cvv: "123" };

  it("accepts a complete card that matches the last four", () => {
    expect(parseCardSecrets(good, "4242", NOW)).toEqual(good);
    expect(parseCardSecrets({ ...good, pan: "4242 4242 4242 4242", expYear: 28 }, "4242", NOW)).toEqual(good);
  });

  it("rejects a number that belongs to a different card", () => {
    expect(parseCardSecrets(good, "1111", NOW)).toBeNull();
  });

  it("rejects a number that fails the Luhn check", () => {
    expect(parseCardSecrets({ ...good, pan: "4242424242424241" }, "4241", NOW)).toBeNull();
  });

  it("rejects malformed or partial responses", () => {
    expect(parseCardSecrets(null, "4242", NOW)).toBeNull();
    expect(parseCardSecrets({ pan: TEST_PAN }, "4242", NOW)).toBeNull();
    expect(parseCardSecrets({ ...good, cvv: "12" }, "4242", NOW)).toBeNull();
    expect(parseCardSecrets({ ...good, cvv: "12a" }, "4242", NOW)).toBeNull();
    expect(parseCardSecrets({ ...good, expMonth: 13 }, "4242", NOW)).toBeNull();
    expect(parseCardSecrets({ ...good, pan: "•••• 4242" }, "4242", NOW)).toBeNull();
    expect(parseCardSecrets(good, "••••", NOW)).toBeNull();
  });

  it("rejects an expired card but accepts the expiry month itself", () => {
    expect(parseCardSecrets({ ...good, expMonth: 9, expYear: 2026 }, "4242", NOW)).toBeNull();
    expect(parseCardSecrets({ ...good, expMonth: 10, expYear: 2026 }, "4242", NOW)).not.toBeNull();
  });
});

describe("cardBackFields", () => {
  it("prints masks, and no digit beyond the last four, without secrets", () => {
    const f = cardBackFields("4242", null);
    expect(f).toEqual({ number: "•••• •••• •••• 4242", expiry: "••/••", cvv: "•••", revealed: false });
    expect(`${f.number}${f.expiry}${f.cvv}`.replace(/\D/g, "")).toBe("4242");
  });

  it("does not echo a last four that is not four digits", () => {
    expect(cardBackFields("12", null).number).toBe("•••• •••• •••• ••••");
  });

  it("prints the vault's values when they are supplied", () => {
    const f = cardBackFields("4242", { pan: TEST_PAN, expMonth: 3, expYear: 2029, cvv: "987" });
    expect(f).toEqual({ number: "4242 4242 4242 4242", expiry: "03/29", cvv: "987", revealed: true });
  });

  it("groups a 15-digit number 4-6-5", () => {
    expect(groupPan("378282246310005")).toBe("3782 822463 10005");
  });
});
