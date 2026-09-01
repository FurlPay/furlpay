import { describe, it, expect } from "vitest";

// The tap rule, extracted so it can be tested without a WebGL canvas.
//
// On a mouse the card is already open by the time a click lands — the pointer
// had to cross the marker to get there — so a click means "show me the whole
// thing". On a touch screen `mousemove` never fires, so going straight to the
// detail panel makes the preview card unreachable. The first tap therefore
// opens the card and the second opens the detail.
//
// This mirrors the branch in HotelMap's click handler. It is duplicated rather
// than imported because the handler closes over map internals; the value here
// is pinning the DECISION TABLE, which is what would regress silently.

type Action = "expand" | "showCard" | "openDetail" | "dismiss";

function decideTap(opts: {
  coarsePointer: boolean;
  hit: { kind: "cluster" | "property"; id: string } | null;
  cardShowingId: string | null;
}): Action {
  const { coarsePointer, hit, cardShowingId } = opts;
  if (!hit) return "dismiss";
  if (hit.kind === "cluster") return "expand";
  if (coarsePointer && cardShowingId !== hit.id) return "showCard";
  return "openDetail";
}

const property = (id = "p1") => ({ kind: "property" as const, id });
const cluster = { kind: "cluster" as const, id: "c1" };

describe("mouse: hover already showed the card, so a click means open it", () => {
  it("opens the detail panel on a property", () => {
    expect(decideTap({ coarsePointer: false, hit: property(), cardShowingId: "p1" }))
      .toBe("openDetail");
  });

  it("opens the detail panel even when no card is open", () => {
    // A keyboard-driven click, or a click that outran the hover handler. On a
    // fine pointer the intent is unambiguous either way.
    expect(decideTap({ coarsePointer: false, hit: property(), cardShowingId: null }))
      .toBe("openDetail");
  });
});

describe("touch: the first tap has to do the work hover would have done", () => {
  it("shows the card on the first tap instead of jumping to the detail panel", () => {
    expect(decideTap({ coarsePointer: true, hit: property(), cardShowingId: null }))
      .toBe("showCard");
  });

  it("opens the detail panel on a second tap of the SAME property", () => {
    expect(decideTap({ coarsePointer: true, hit: property("p1"), cardShowingId: "p1" }))
      .toBe("openDetail");
  });

  it("moves the card rather than opening detail when tapping a DIFFERENT marker", () => {
    // The gesture looks like it should move the card, so it does. Requiring a
    // dismiss-then-tap would make dense areas miserable.
    expect(decideTap({ coarsePointer: true, hit: property("p2"), cardShowingId: "p1" }))
      .toBe("showCard");
  });
});

describe("shared behaviour, whichever way you point", () => {
  it.each([[true], [false]])("a cluster always expands (coarse=%s)", (coarse) => {
    expect(decideTap({ coarsePointer: coarse, hit: cluster, cardShowingId: null }))
      .toBe("expand");
    expect(decideTap({ coarsePointer: coarse, hit: cluster, cardShowingId: "c1" }))
      .toBe("expand");
  });

  it.each([[true], [false]])("tapping empty map dismisses the card (coarse=%s)", (coarse) => {
    expect(decideTap({ coarsePointer: coarse, hit: null, cardShowingId: "p1" }))
      .toBe("dismiss");
  });
});

describe("the full decision table", () => {
  it("is exhaustive and has no unreachable branch", () => {
    const rows: Array<[boolean, "cluster" | "property" | null, string | null, Action]> = [
      [false, null,       "p1",  "dismiss"],
      [false, "cluster",  null,  "expand"],
      [false, "property", null,  "openDetail"],
      [false, "property", "p1",  "openDetail"],
      [true,  null,       "p1",  "dismiss"],
      [true,  "cluster",  null,  "expand"],
      [true,  "property", null,  "showCard"],
      [true,  "property", "p2",  "showCard"],
      [true,  "property", "p1",  "openDetail"],
    ];
    for (const [coarse, kind, showing, expected] of rows) {
      const hit = kind === null ? null : kind === "cluster" ? cluster : property("p1");
      expect(
        decideTap({ coarsePointer: coarse, hit, cardShowingId: showing }),
        `coarse=${coarse} hit=${kind} showing=${showing}`
      ).toBe(expected);
    }
  });
});
