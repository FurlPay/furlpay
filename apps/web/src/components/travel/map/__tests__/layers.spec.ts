import { describe, expect, it } from "vitest";
import { bandFor } from "../layers";

// ---------------------------------------------------------------------------
// The marker table.
//
// buildFeatures needs a live MapLibre instance to project coordinates, so it is
// exercised in the browser rather than here. What IS testable in isolation is
// the invariant the whole marker design rests on: size and colour are read off
// one table, so a marker can never be large and green.
// ---------------------------------------------------------------------------

describe("count bands", () => {
  it("grows monotonically with the count", () => {
    const counts = [1, 5, 6, 15, 16, 50, 51, 100, 101, 5000];
    const radii = counts.map((c) => bandFor(c).r);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThanOrEqual(radii[i - 1]);
    }
  });

  it("never leaves a count unbanded", () => {
    for (const c of [1, 7, 42, 99, 500, 10_000]) {
      const band = bandFor(c);
      expect(band.r).toBeGreaterThan(0);
      expect(band.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("keeps size and colour agreeing", () => {
    // The failure this guards against is a marker that reads "few" by size and
    // "many" by colour. Same row, so it cannot happen — asserted rather than
    // assumed, because the two are read at different call sites.
    const small = bandFor(3);
    const large = bandFor(500);
    expect(small.r).toBeLessThan(large.r);
    expect(small.bg).not.toBe(large.bg);
  });

  it("gives every band a label colour that is actually readable on it", () => {
    // Pins the PROPERTY, not the palette. The previous version hardcoded the
    // amber hex as "the light one", so re-toning the bands failed the test
    // without anything having become unreadable. This measures contrast, so it
    // keeps working through a palette change and still fails a real one.
    const luminance = (hex: string) => {
      const c = (i: number) => {
        const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2);
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    for (const count of [1, 20, 60, 200]) {
      const b = bandFor(count);
      // 3:1 is the WCAG floor for large/bold text, which is what a count
      // inside a marker is. White on amber lands near 2:1 and fails it.
      expect({ count, ratio: contrast(b.fg, b.bg) >= 3 }).toEqual({ count, ratio: true });
    }
  });
});
