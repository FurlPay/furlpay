import { describe, it, expect } from "vitest";
import { HeadingFusion, gpsCourseQuality, compassWeight, type FusionInput } from "../headingFusion";
import type { CompassConfidence } from "../compassConfidence";
import type { MapMatch } from "../mapMatchHeading";

const conf = (level: CompassConfidence["level"]): CompassConfidence => ({
  level,
  errorDegrees: level === "high" ? 5 : level === "medium" ? 20 : 45,
  needsCalibration: level === "low",
  source: "inferred",
});

const noMap: MapMatch = { bearing: null, errorDegrees: null, support: 0, candidates: 0 };
const road = (bearing: number, support = 0.9): MapMatch => ({
  bearing, errorDegrees: 3, support, candidates: 4,
});

const input = (over: Partial<FusionInput> = {}): FusionInput => ({
  compassHeading: null,
  compassConfidence: conf("unknown"),
  gpsCourse: null,
  speed: null,
  positionAccuracy: 10,
  mapMatch: noMap,
  now: 0,
  ...over,
});

/** Drive the engine forward past the dwell timer so a source can take over. */
const settle = (f: HeadingFusion, base: Partial<FusionInput>, from = 0, steps = 6) => {
  let out = f.update(input({ ...base, now: from }));
  for (let i = 1; i <= steps; i++) out = f.update(input({ ...base, now: from + i * 600 }));
  return out;
};

describe("GPS course quality is not the same question as 'is course non-null'", () => {
  it("rejects a course at a shuffle", () => {
    // 0.2 m/s is position noise, not travel.
    expect(gpsCourseQuality(90, 0.2, 10, false)).toBe(0);
  });

  it("accepts a course at walking pace", () => {
    expect(gpsCourseQuality(90, 1.4, 10, false)).toBeGreaterThan(0.4);
  });

  it("rejects a course when the fix itself is vague", () => {
    // Course is the direction between two fixes. At +/-50m that is close to
    // random at walking speed.
    expect(gpsCourseQuality(90, 1.4, 60, false)).toBe(0);
  });

  it("is harder to start believing than to keep believing", () => {
    // The hysteresis that stops a dawdling reader flipping every fix.
    expect(gpsCourseQuality(90, 0.5, 10, false)).toBe(0);   // entering
    expect(gpsCourseQuality(90, 0.5, 10, true)).toBeGreaterThan(0); // sustaining
  });

  it("treats unreported accuracy as doubt, not as a good fix", () => {
    expect(gpsCourseQuality(90, 1.4, null, false)).toBeLessThan(
      gpsCourseQuality(90, 1.4, 5, false)
    );
  });

  it("returns nothing for a null or non-finite course", () => {
    expect(gpsCourseQuality(null, 2, 10, false)).toBe(0);
    expect(gpsCourseQuality(NaN, 2, 10, false)).toBe(0);
  });
});

describe("compass weight tracks confidence", () => {
  it("ranks the levels", () => {
    expect(compassWeight(conf("high"))).toBeGreaterThan(compassWeight(conf("medium")));
    expect(compassWeight(conf("medium"))).toBeGreaterThan(compassWeight(conf("low")));
    expect(compassWeight(conf("unknown"))).toBe(0);
  });
});

describe("stationary — the compass is the only thing that can help", () => {
  it("uses the compass when standing still", () => {
    const f = new HeadingFusion();
    const out = settle(f, { compassHeading: 90, compassConfidence: conf("high"), speed: 0 });
    expect(out.source).toBe("compass");
    expect(out.state).toBe("stationary_compass");
    expect(out.heading).toBeCloseTo(90, 0);
  });

  it("does NOT let GPS jitter rotate the map while standing still", () => {
    // The failure this prevents: a stationary reader whose fixes wander,
    // producing a course that spins the arrow.
    const f = new HeadingFusion();
    settle(f, { compassHeading: 90, compassConfidence: conf("high"), speed: 0 });
    const out = f.update(input({
      compassHeading: 90, compassConfidence: conf("high"),
      gpsCourse: 300, speed: 0.15, now: 5000,
    }));
    expect(out.source).toBe("compass");
    expect(out.heading).toBeCloseTo(90, 0);
  });
});

describe("moving — GPS course takes over", () => {
  it("prefers the course once genuinely walking", () => {
    const f = new HeadingFusion();
    const out = settle(f, {
      compassHeading: 10, compassConfidence: conf("medium"),
      gpsCourse: 180, speed: 1.4,
    });
    expect(out.source).toBe("gps");
    expect(out.state).toBe("moving_gps");
  });

  it("snaps the course to a road when one agrees", () => {
    const f = new HeadingFusion();
    const out = settle(f, { gpsCourse: 88, speed: 1.5, mapMatch: road(90) });
    expect(out.source).toBe("map");
    expect(out.state).toBe("moving_map_matched");
    expect(out.heading).toBeCloseTo(90, 0);
  });

  it("snaps to the reciprocal when walking the other way down the road", () => {
    const f = new HeadingFusion();
    const out = settle(f, { gpsCourse: 268, speed: 1.5, mapMatch: road(90) });
    expect(out.heading).toBeCloseTo(270, 0);
  });

  it("ignores the map where the geometry says nothing", () => {
    // A plaza, a beach, a resort lawn. No opinion is not an opinion against.
    const f = new HeadingFusion();
    const out = settle(f, { gpsCourse: 45, speed: 1.5, mapMatch: noMap });
    expect(out.source).toBe("gps");
  });
});

describe("disagreement — the case the whole engine exists for", () => {
  it("stops believing a compass the reader's movement contradicts", () => {
    // Compass insists east; the reader is demonstrably walking north.
    const f = new HeadingFusion();
    const out = settle(f, {
      compassHeading: 90, compassConfidence: conf("high"),
      gpsCourse: 0, speed: 1.5, mapMatch: road(0),
    });
    expect(out.source).toBe("map");
    expect(out.heading).toBeCloseTo(0, 0);
  });

  it("holds the last good heading when everything becomes untrustworthy", () => {
    const f = new HeadingFusion();
    settle(f, { compassHeading: 45, compassConfidence: conf("high"), speed: 0 });
    const out = f.update(input({
      compassHeading: 200, compassConfidence: conf("low"), speed: 0, now: 9000,
    }));
    expect(out.source).toBe("held");
    expect(out.state).toBe("uncertain");
    expect(out.heading).toBeCloseTo(45, 0);
  });

  it("decays confidence in a held heading rather than keeping it forever", () => {
    const f = new HeadingFusion();
    settle(f, { compassHeading: 45, compassConfidence: conf("high"), speed: 0 });
    const soon = f.update(input({ compassConfidence: conf("low"), speed: 0, now: 8000 }));
    const later = f.update(input({ compassConfidence: conf("low"), speed: 0, now: 25000 }));
    expect(later.confidence).toBeLessThan(soon.confidence);
    expect(later.confidence).toBeLessThanOrEqual(0.05);
  });

  it("says so plainly when there is nothing at all", () => {
    const f = new HeadingFusion();
    const out = f.update(input());
    expect(out.heading).toBeNull();
    expect(out.state).toBe("unknown");
    expect(out.source).toBe("none");
  });
});

describe("hysteresis stops the arrow oscillating", () => {
  it("does not hand authority over on a single sample", () => {
    const f = new HeadingFusion();
    settle(f, { compassHeading: 0, compassConfidence: conf("high"), speed: 0 });
    // One walking sample arrives. Not enough.
    const out = f.update(input({
      compassHeading: 0, compassConfidence: conf("high"),
      gpsCourse: 180, speed: 1.5, now: 4000,
    }));
    expect(out.source).toBe("compass");
  });

  it("hands over once the new source has kept winning", () => {
    const f = new HeadingFusion();
    settle(f, { compassHeading: 0, compassConfidence: conf("high"), speed: 0 });
    const out = settle(f,
      { compassHeading: 0, compassConfidence: conf("high"), gpsCourse: 180, speed: 1.5 },
      4000);
    expect(out.source).toBe("gps");
  });

  it("survives a signal flapping without changing source", () => {
    const f = new HeadingFusion();
    settle(f, { compassHeading: 0, compassConfidence: conf("high"), speed: 0 });
    let out = f.update(input({ compassHeading: 0, compassConfidence: conf("high"), speed: 0, now: 4000 }));
    for (let i = 1; i <= 6; i++) {
      // Alternating: one walking sample, one stationary, repeatedly.
      out = f.update(input({
        compassHeading: 0, compassConfidence: conf("high"),
        gpsCourse: 180, speed: i % 2 ? 1.5 : 0, now: 4000 + i * 400,
      }));
    }
    expect(out.source).toBe("compass");
  });
});

describe("circular smoothing", () => {
  it("crosses the 0/360 seam the short way", () => {
    const f = new HeadingFusion();
    settle(f, { compassHeading: 350, compassConfidence: conf("high"), speed: 0 });
    let out = f.update(input({ compassHeading: 10, compassConfidence: conf("high"), speed: 0, now: 5000 }));
    for (let i = 1; i <= 12; i++) {
      out = f.update(input({ compassHeading: 10, compassConfidence: conf("high"), speed: 0, now: 5000 + i * 300 }));
    }
    // Angular distance, not subtraction: a plain difference calls 359 and 1
    // "358 apart" and would pass here for entirely the wrong reason.
    const apart = (a: number, b: number) => Math.abs(((a - b + 180) % 360) - 180);
    // It converged on the target...
    expect(apart(out.heading!, 10)).toBeLessThan(5);
    // ...and never went anywhere near the long way round.
    expect(apart(out.heading!, 180)).toBeGreaterThan(150);
  });

  it("never returns a heading outside [0, 360)", () => {
    const f = new HeadingFusion();
    for (const h of [359, 1, 180, 270, 0.5]) {
      const out = settle(f, { compassHeading: h, compassConfidence: conf("high"), speed: 0 });
      if (out.heading !== null) {
        expect(out.heading).toBeGreaterThanOrEqual(0);
        expect(out.heading).toBeLessThan(360);
      }
    }
  });
});

describe("reset", () => {
  it("forgets everything", () => {
    const f = new HeadingFusion();
    settle(f, { compassHeading: 90, compassConfidence: conf("high"), speed: 0 });
    f.reset();
    const out = f.update(input());
    expect(out.heading).toBeNull();
    expect(out.state).toBe("unknown");
  });
});
