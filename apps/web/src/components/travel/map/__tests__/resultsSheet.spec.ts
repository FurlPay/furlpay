import { describe, expect, it } from "vitest";
import { settleSnap, snapHeights } from "../ResultsSheet";

describe("bottom sheet snapping", () => {
  const H = 700;
  const hs = snapHeights(H);

  it("has peek < half < full inside the container", () => {
    expect(hs.peek).toBeLessThan(hs.half);
    expect(hs.half).toBeLessThan(hs.full);
    expect(hs.full).toBeLessThanOrEqual(H);
  });

  it("settles a slow release on the nearest snap", () => {
    expect(settleSnap(hs.peek + 20, 0, H)).toBe("peek");
    expect(settleSnap(hs.half - 30, 0.1, H)).toBe("half");
    expect(settleSnap(hs.full - 10, -0.1, H)).toBe("full");
  });

  it("moves one snap in the direction of a fast flick", () => {
    // Flick up from just above peek → half, not full.
    expect(settleSnap(hs.peek + 30, -1.2, H)).toBe("half");
    // Flick down from just below full → half.
    expect(settleSnap(hs.full - 30, 1.2, H)).toBe("half");
    // Flick down at peek stays at peek; flick up at full stays at full.
    expect(settleSnap(hs.peek, 1.5, H)).toBe("peek");
    expect(settleSnap(hs.full, -1.5, H)).toBe("full");
  });

  it("copes with a tiny container", () => {
    const tiny = snapHeights(100);
    expect(tiny.full).toBeGreaterThan(tiny.peek);
  });
});
