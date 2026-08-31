import { describe, expect, it } from "vitest";
import {
  DRIFT_THRESHOLD,
  ZOOM_EPSILON,
  decideViewAction,
  uncoveredFraction,
  type BBox,
} from "../viewport";

// ---------------------------------------------------------------------------
// This decides whether the map fetches, offers, or does nothing after the
// reader moves it. Getting it wrong is not subtle in either direction: too
// eager and the map fires a request per pause while someone drags across a
// continent; too reluctant and they end up staring at markers for a place they
// have already left, with no way to ask for the one they are looking at.
// ---------------------------------------------------------------------------

const box = (minLng: number, minLat: number, maxLng: number, maxLat: number): BBox => ({
  minLng, minLat, maxLng, maxLat,
});

/** A 10×10 degree window. */
const LOADED = box(0, 0, 10, 10);

describe("uncoveredFraction", () => {
  it("is zero when the view has not left what was fetched", () => {
    expect(uncoveredFraction(LOADED, box(2, 2, 8, 8))).toBe(0);
  });

  it("is zero for the identical box", () => {
    expect(uncoveredFraction(LOADED, LOADED)).toBe(0);
  });

  it("is one when the boxes do not touch", () => {
    expect(uncoveredFraction(LOADED, box(50, 50, 60, 60))).toBe(1);
  });

  it("is one when the boxes only share an edge", () => {
    // Touching is not overlapping — a zero-area intersection covers nothing.
    expect(uncoveredFraction(LOADED, box(10, 0, 20, 10))).toBe(1);
  });

  it("reports half for a view half outside", () => {
    expect(uncoveredFraction(LOADED, box(5, 0, 15, 10))).toBeCloseTo(0.5, 6);
  });

  it("reports three quarters when only a corner overlaps", () => {
    expect(uncoveredFraction(LOADED, box(5, 5, 15, 15))).toBeCloseTo(0.75, 6);
  });

  it("reports mostly-uncovered when the view zooms out past what was fetched", () => {
    // A 20x20 view around a 10x10 fetch: a quarter of the screen is described.
    expect(uncoveredFraction(LOADED, box(0, 0, 20, 20))).toBeCloseTo(0.75, 6);
  });

  describe("degenerate input", () => {
    it("treats a zero-width view as uncovered", () => {
      expect(uncoveredFraction(LOADED, box(5, 0, 5, 10))).toBe(1);
    });

    it("treats an inverted view as uncovered", () => {
      // "I cannot tell" must not read as "fully covered", which would suppress
      // the offer exactly when the map is in a state nobody reasoned about.
      expect(uncoveredFraction(LOADED, box(10, 10, 0, 0))).toBe(1);
    });

    it("treats a non-finite view as uncovered", () => {
      expect(uncoveredFraction(LOADED, box(0, 0, Number.NaN, 10))).toBe(1);
    });
  });
});

describe("decideViewAction", () => {
  const at = (bbox: BBox, zoom = 10) => ({ bbox, zoom });

  it("fetches when nothing has ever been loaded", () => {
    // There is no view to compare against, so offering a button for data that
    // has never existed would leave the map permanently empty.
    expect(decideViewAction(null, at(LOADED))).toBe("refetch");
  });

  it("does nothing for a nudge inside what is already drawn", () => {
    expect(decideViewAction(at(LOADED), at(box(1, 1, 11, 11)))).toBe("nothing");
  });

  it("offers when the reader has panned away", () => {
    expect(decideViewAction(at(LOADED), at(box(8, 0, 18, 10)))).toBe("offer");
  });

  it("fetches on a zoom change rather than offering", () => {
    // The API clusters for a given zoom and caps the response, so a different
    // zoom is a different answer — not the same answer re-framed. Making the
    // reader ask for it would be asking them to confirm the thing they just did.
    expect(decideViewAction(at(LOADED, 10), at(LOADED, 13))).toBe("refetch");
  });

  it("ignores a zoom change too small to mean anything", () => {
    // Trackpad pinches emit a stream of small deltas while someone is still
    // adjusting; each settled frame must not be a new request.
    const nudge = ZOOM_EPSILON / 2;
    expect(decideViewAction(at(LOADED, 10), at(LOADED, 10 + nudge))).toBe("nothing");
  });

  it("fetches on zoom even when the box has not moved at all", () => {
    expect(decideViewAction(at(LOADED, 10), at(LOADED, 10 + ZOOM_EPSILON + 0.01))).toBe(
      "refetch"
    );
  });

  describe("at the drift threshold", () => {
    // Built so the uncovered fraction lands either side of the cutoff, rather
    // than asserting a hand-picked box and hoping it stays on the right side.
    const shiftedBy = (fraction: number) => box(10 * fraction, 0, 10 + 10 * fraction, 10);

    it("does nothing just below it", () => {
      const now = shiftedBy(DRIFT_THRESHOLD - 0.05);
      expect(uncoveredFraction(LOADED, now)).toBeLessThan(DRIFT_THRESHOLD);
      expect(decideViewAction(at(LOADED), at(now))).toBe("nothing");
    });

    it("offers just above it", () => {
      const now = shiftedBy(DRIFT_THRESHOLD + 0.05);
      expect(uncoveredFraction(LOADED, now)).toBeGreaterThan(DRIFT_THRESHOLD);
      expect(decideViewAction(at(LOADED), at(now))).toBe("offer");
    });
  });
});
