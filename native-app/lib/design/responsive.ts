import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { sizeClassFor, type SizeClass } from "./tokens";

// ---------------------------------------------------------------------------
// Adaptive layout.
//
// The rule the brief states and this file enforces: DO NOT STRETCH THE PHONE
// UI. A 900dp-wide screen showing one 900dp-wide column of transaction rows is
// worse than the phone layout, not better — the eye has to travel the full
// width to pair a merchant with its amount.
//
// Size class is keyed off the SHORTEST edge, not the width, so a phone in
// landscape stays "compact": it has a tablet's width and none of its height,
// and giving it a two-column layout produces two columns three rows tall.
// ---------------------------------------------------------------------------

export interface Layout {
  sizeClass: SizeClass;
  /** True on a phone (either orientation). */
  isCompact: boolean;
  /** True where a navigation rail beats a bottom bar. */
  useRail: boolean;
  /** Columns for a grid of cards at this size. */
  columns: number;
  /**
   * Cap for a column of running text or a form.
   *
   * Text stops being readable much past ~70 characters per line, so on a wide
   * screen the content is centred inside a cap rather than filled to the edge.
   */
  maxContentWidth: number;
  /** True where a list and a detail pane can sit side by side. */
  supportsTwoPane: boolean;
  /** Horizontal page padding, larger on bigger screens. */
  gutter: number;
}

/**
 * Resolve a layout from raw dimensions.
 *
 * Pure, so it is exhaustively testable without mounting anything — which is why
 * the hook below is a thin wrapper rather than the implementation.
 */
export function layoutFor(width: number, height: number): Layout {
  const shortest = Math.min(width, height);
  const sizeClass = sizeClassFor(shortest);
  const landscape = width > height;

  switch (sizeClass) {
    case "expanded":
      return {
        sizeClass,
        isCompact: false,
        useRail: true,
        columns: landscape ? 3 : 2,
        maxContentWidth: 720,
        supportsTwoPane: true,
        gutter: 24,
      };
    case "medium":
      return {
        sizeClass,
        isCompact: false,
        useRail: true,
        columns: 2,
        maxContentWidth: 640,
        // A two-pane split needs real width, not just a non-phone short edge.
        supportsTwoPane: landscape,
        gutter: 20,
      };
    default:
      return {
        sizeClass,
        isCompact: true,
        useRail: false,
        columns: 1,
        // Effectively uncapped: on a phone the column IS the screen.
        maxContentWidth: Number.POSITIVE_INFINITY,
        supportsTwoPane: false,
        gutter: 16,
      };
  }
}

/**
 * Style for a centred, width-capped content column.
 *
 * `alignSelf: "center"` rather than a margin so it composes inside a flex
 * parent without fighting the parent's alignment.
 */
export function contentColumn(layout: Layout) {
  return layout.maxContentWidth === Number.POSITIVE_INFINITY
    ? { width: "100%" as const }
    : { width: "100%" as const, maxWidth: layout.maxContentWidth, alignSelf: "center" as const };
}

/**
 * The live layout for the current window.
 *
 * A thin wrapper over `layoutFor` so the decision logic stays pure and
 * testable. `useWindowDimensions` re-renders on rotation and on a foldable
 * unfolding, so the layout follows a live resize rather than being sampled once
 * at mount.
 */
export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return useMemo(() => layoutFor(width, height), [width, height]);
}
