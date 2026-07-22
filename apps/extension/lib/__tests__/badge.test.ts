import { describe, expect, it } from "vitest";
import { badgeLabel, badgeTextFor } from "../badge";

// The toolbar badge is permanently visible chrome. Two properties matter:
// it must fit Chrome's 4-character truncation, and it must be maskable —
// it renders the user's entire net worth during every screen share.

describe("badgeLabel", () => {
  it("never exceeds Chrome's 4-character budget, at any magnitude", () => {
    // Every band boundary, and either side of each one — rounding at a
    // boundary is exactly where the old implementation overflowed.
    const amounts = [
      0, 0.4, 1, 99, 100, 999, 999.4, 999.5, 999.6, 1_000, 4_242,
      9_949, 9_950, 9_999, 10_000, 42_000, 99_949, 99_950, 99_999, 100_000,
      250_000, 999_499, 999_500, 999_999, 1_000_000, 1_500_000,
      9_949_999, 9_950_000, 9_999_999, 10_000_000, 42_000_000,
      999_499_999, 999_500_000, 1_000_000_000, 9_999_999_999,
    ];
    for (const usd of amounts) {
      const label = badgeLabel(usd);
      expect(label.length, `badgeLabel(${usd}) === ${JSON.stringify(label)}`).toBeLessThanOrEqual(4);
    }
  });

  it("formats each magnitude band the way the UI expects", () => {
    expect(badgeLabel(980)).toBe("$980");
    expect(badgeLabel(4_242)).toBe("4.2k");
    expect(badgeLabel(42_000)).toBe("42k");
    expect(badgeLabel(250_000)).toBe("250k");
    expect(badgeLabel(1_500_000)).toBe("1.5M");
    expect(badgeLabel(42_000_000)).toBe("42M");
    expect(badgeLabel(5_000_000_000)).toBe(">1B");
  });

  it("does not round a sub-$1000 balance up into a 5-character label", () => {
    // $999.60 is below the 1k band but rounds to 1000 — "$1000" overflows.
    expect(badgeLabel(999.6)).toBe("1.0k");
  });
});

describe("badgeTextFor", () => {
  it("shows the balance when the preference is on", () => {
    expect(badgeTextFor(4_242, true)).toBe("4.2k");
  });

  it("masks every amount to the same glyph when off — no magnitude leak", () => {
    const masked = [1, 980, 4_242, 250_000, 9_999_999].map((v) => badgeTextFor(v, false));
    expect(new Set(masked).size).toBe(1);
    expect(masked[0]).not.toMatch(/\d/);
  });

  it("still renders something when masked, so the badge reads as signed in", () => {
    expect(badgeTextFor(980, false).length).toBeGreaterThan(0);
  });
});
