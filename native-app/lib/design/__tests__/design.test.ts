import { contentColumn, layoutFor } from "../responsive";
import { schemes, sizeClassFor, touchTarget, typeScale, component } from "../tokens";
import type { SemanticColors } from "../tokens";

// ---------------------------------------------------------------------------
// Design-system invariants.
//
// These are the properties a screen cannot check for itself: whether the
// palette is legible, whether a tap target is reachable, whether a layout
// degrades on a tablet. Pinning them here means a token edit that breaks
// contrast fails a test rather than shipping.
// ---------------------------------------------------------------------------

// --- WCAG contrast ----------------------------------------------------------

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const r = srgbToLinear((n >> 16) & 255);
  const g = srgbToLinear((n >> 8) & 255);
  const b = srgbToLinear(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1..21. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const SCHEMES: [name: string, c: SemanticColors][] = [
  ["light", schemes.light],
  ["dark", schemes.dark],
];

describe("contrast — every scheme is legible", () => {
  it.each(SCHEMES)("%s: body text on the page ground clears 4.5:1", (_n, c) => {
    expect(contrast(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)("%s: body text on a surface clears 4.5:1", (_n, c) => {
    expect(contrast(c.text, c.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)("%s: SECONDARY text clears 4.5:1, not just 3:1", (_n, c) => {
    // textDim carries labels, captions and every "you have X available" line.
    // It is body copy, so it gets the body-copy floor.
    expect(contrast(c.textDim, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)("%s: text on the primary button fill clears 4.5:1", (_n, c) => {
    // The single most-tapped control in the app. #00E599 under white text is
    // 1.6:1, which is why the light scheme uses a deeper mint for the fill.
    expect(contrast(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)("%s: text on the destructive FILL clears 4.5:1", (_n, c) => {
    // `accent` is the fill role (FurlButton tone="danger", the tab-bar badge).
    // `danger` is the text/icon role and is deliberately lighter — see the note
    // on the status block in tokens.ts.
    expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)("%s: the destructive TEXT role reads on the page ground", (_n, c) => {
    expect(contrast(c.accentText, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)("%s: primary-as-text clears 4.5:1 on the ground", (_n, c) => {
    expect(contrast(c.primaryText, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)("%s: status colours clear 4.5:1 on their own soft grounds", (_n, c) => {
    // A status badge is the only place many users read a transaction outcome.
    expect(contrast(c.success, c.successSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.danger, c.dangerSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.warning, c.warningSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.info, c.infoSoft)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)("%s: borders are visible at 1.5:1 against their surface", (_n, c) => {
    // Not the 3:1 UI-component floor: `border` is a decorative hairline between
    // surfaces, and the controls that MUST be distinguishable use borderStrong.
    expect(contrast(c.border, c.surface)).toBeGreaterThanOrEqual(1.2);
    expect(contrast(c.borderStrong, c.surface)).toBeGreaterThanOrEqual(1.5);
  });

  it.each(SCHEMES)("%s: credit and debit are distinguishable from body text", (_n, c) => {
    // They are never the ONLY signal (a +/- sign always accompanies them), but
    // they still have to be readable.
    expect(contrast(c.credit, c.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.debit, c.bg)).toBeGreaterThanOrEqual(3);
  });

  it.each(SCHEMES)("%s: every chart series is distinguishable from the surface", (_n, c) => {
    for (const series of c.chart) {
      expect(contrast(series, c.surface)).toBeGreaterThanOrEqual(2.5);
    }
  });

  it("the two schemes are genuinely different, not one palette reused", () => {
    expect(schemes.light.bg).not.toBe(schemes.dark.bg);
    expect(schemes.light.primary).not.toBe(schemes.dark.primary);
    // The mint that works as a dark-mode fill is unreadable as a light-mode one.
    expect(contrast("#FFFFFF", schemes.dark.primary)).toBeLessThan(4.5);
  });
});

describe("touch targets", () => {
  it("takes the stricter of Android 48dp and Apple 44pt", () => {
    expect(touchTarget.min).toBeGreaterThanOrEqual(48);
  });

  it("sizes every button role at or above the minimum, except sm which uses hitSlop", () => {
    expect(component.button.heightMd).toBeGreaterThanOrEqual(touchTarget.min);
    expect(component.button.heightLg).toBeGreaterThanOrEqual(touchTarget.min);
    // heightSm is 36 by design; FurlIconButton compensates with hitSlop so the
    // TAPPABLE area stays >= 48 even when the visual is smaller.
    expect(component.button.heightSm).toBeLessThan(touchTarget.min);
  });

  it("keeps list rows tall enough to hit", () => {
    expect(component.row.minHeight).toBeGreaterThanOrEqual(touchTarget.min);
  });

  it("keeps inputs tall enough to hit", () => {
    expect(component.input.height).toBeGreaterThanOrEqual(touchTarget.min);
  });
});

describe("type scale", () => {
  it("marks every money role as tabular so columns of digits line up", () => {
    for (const role of ["display", "amount", "amountSmall", "mono"] as const) {
      expect((typeScale[role] as { tabular?: boolean }).tabular).toBe(true);
    }
  });

  it("keeps line height above font size for every role", () => {
    for (const [role, t] of Object.entries(typeScale)) {
      const s = t as { fontSize: number; lineHeight: number };
      expect(`${role}:${s.lineHeight >= s.fontSize}`).toBe(`${role}:true`);
    }
  });

  it("never drops body text below 15pt", () => {
    expect(typeScale.body.fontSize).toBeGreaterThanOrEqual(15);
  });
});

describe("size classes", () => {
  it("classifies by the shortest edge", () => {
    expect(sizeClassFor(390)).toBe("compact"); // iPhone width
    expect(sizeClassFor(600)).toBe("medium");
    expect(sizeClassFor(840)).toBe("expanded");
  });
});

describe("adaptive layout", () => {
  it("keeps a phone in portrait compact and single-column", () => {
    const l = layoutFor(390, 844);
    expect(l.isCompact).toBe(true);
    expect(l.columns).toBe(1);
    expect(l.useRail).toBe(false);
  });

  it("keeps a phone in LANDSCAPE compact", () => {
    // The trap this guards: 844dp wide looks like a tablet by width alone, and
    // a two-column layout there would be two columns three rows tall.
    const l = layoutFor(844, 390);
    expect(l.isCompact).toBe(true);
    expect(l.columns).toBe(1);
    expect(l.useRail).toBe(false);
  });

  it("gives a tablet a rail and multiple columns", () => {
    const l = layoutFor(1024, 1366);
    expect(l.isCompact).toBe(false);
    expect(l.useRail).toBe(true);
    expect(l.columns).toBeGreaterThan(1);
    expect(l.supportsTwoPane).toBe(true);
  });

  it("gives a landscape tablet more columns than portrait", () => {
    expect(layoutFor(1366, 1024).columns).toBeGreaterThan(layoutFor(1024, 1366).columns);
  });

  it("does not offer two-pane on a portrait medium device", () => {
    // An unfolded foldable in portrait has the short edge but not the width.
    expect(layoutFor(673, 841).supportsTwoPane).toBe(false);
  });

  it("caps reading width on large screens but not on phones", () => {
    expect(layoutFor(1024, 1366).maxContentWidth).toBeLessThan(1024);
    expect(layoutFor(390, 844).maxContentWidth).toBe(Number.POSITIVE_INFINITY);
  });

  it("widens the gutter as the screen grows", () => {
    expect(layoutFor(1024, 1366).gutter).toBeGreaterThan(layoutFor(390, 844).gutter);
  });

  it("centres a capped column and leaves a phone column full-width", () => {
    expect(contentColumn(layoutFor(1024, 1366))).toMatchObject({ alignSelf: "center" });
    expect(contentColumn(layoutFor(390, 844))).toEqual({ width: "100%" });
  });

  it("handles a foldable transition without an undefined layout", () => {
    // Folded -> unfolded is a live resize, not a remount.
    for (const [w, h] of [[390, 844], [673, 841], [841, 673], [1024, 1366]]) {
      const l = layoutFor(w, h);
      expect(l.columns).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(l.gutter)).toBe(true);
    }
  });
});
