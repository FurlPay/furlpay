"use client";

import { useMemo } from "react";
import type { MapCluster, MapPoint } from "@/app/api/travel/hotels/map/route";
import type { FeatureKind } from "./layers";

// ---------------------------------------------------------------------------
// The map, as a list.
//
// WHY THIS EXISTS. The markers are drawn on a GPU canvas, and a canvas has
// nothing in the accessibility tree — there is no element to focus, and a
// screen reader is told only that a canvas exists. Mapbox shipped an
// accessibility plugin for exactly this and discontinued it in 2022; the
// pattern that outlived it is the one used here: keep a semantic DOM equivalent
// of every meaningful thing drawn, and let the keyboard operate that.
//
// IT IS NOT A CONSOLATION PRIZE. The DOM-marker version this replaced was
// WORSE for keyboard users, not better: focusing a pin opened the hover card,
// and the pin's `blur` handler closed it 200ms later, so Tab could never land
// inside the card and "View all" was unreachable by any means. Here the list
// item and the card are ordinary siblings in one focus order, so Tab simply
// works.
//
// WHY IT IS VISUALLY HIDDEN RATHER THAN `display: none`. A hidden element is
// removed from the accessibility tree along with everything else; this has to
// stay in the tree and merely not be painted. It becomes visible on focus, so
// a sighted keyboard user can see where they are — a list that steals focus
// invisibly is its own bug.
//
// The list mirrors what the map is actually showing, in the order the map
// draws it, so "next" in the list is the next thing a sighted user would read.
// ---------------------------------------------------------------------------

export interface ListEntry {
  id: string;
  kind: FeatureKind;
  cluster?: MapCluster;
  point?: MapPoint;
  lngLat: [number, number];
}

function describe(entry: ListEntry): { primary: string; secondary: string } {
  if (entry.kind === "cluster" && entry.cluster) {
    const c = entry.cluster;
    const parts = [
      `${c.families.hotels} hotels`,
      `${c.families.resorts} resorts`,
      `${c.families.villas} villas`,
    ].filter((p) => !p.startsWith("0 "));
    return {
      primary: `${c.label} — ${c.count} luxury ${c.count === 1 ? "property" : "properties"}`,
      secondary: `${parts.join(", ")}. ${c.confirmed} of ${c.count} positions confirmed. Activate to zoom in.`,
    };
  }

  const p = entry.point!;
  const place = [p.city, p.country].filter(Boolean).join(", ");
  const bits = [
    p.stars ? `${p.stars} star` : null,
    p.hotelType,
    place,
    entry.kind === "osm"
      ? "from OpenStreetMap"
      : p.precision === "exact"
        ? "position confirmed"
        : "approximate position",
  ].filter(Boolean);

  return { primary: p.name, secondary: `${bits.join(", ")}. Activate to open details.` };
}

export default function AccessibleMarkerList({
  entries,
  onFocusEntry,
  onActivate,
  onBlurEntry,
}: {
  entries: ListEntry[];
  /** Opens the same hover card a mouse would, anchored to the same marker. */
  onFocusEntry: (entry: ListEntry) => void;
  onActivate: (entry: ListEntry) => void;
  onBlurEntry: () => void;
}) {
  // Clusters first, then properties — the same order the map stacks them, so a
  // keyboard user meets the summary before the detail rather than tabbing
  // through 200 individual hotels to reach the region they stand in.
  const ordered = useMemo(() => {
    const rank: Record<FeatureKind, number> = { cluster: 0, property: 1, osm: 2 };
    return [...entries].sort((a, b) => rank[a.kind] - rank[b.kind]);
  }, [entries]);

  if (!ordered.length) return null;

  return (
    <div className="hm-a11y-list">
      <h2 id="hm-a11y-heading" className="hm-a11y-heading">
        {ordered.length} map {ordered.length === 1 ? "marker" : "markers"} in the current view
      </h2>
      <ul aria-labelledby="hm-a11y-heading">
        {ordered.map((entry) => {
          const { primary, secondary } = describe(entry);
          return (
            <li key={entry.id}>
              <button
                type="button"
                onFocus={() => onFocusEntry(entry)}
                onBlur={onBlurEntry}
                onClick={() => onActivate(entry)}
              >
                <span className="hm-a11y-primary">{primary}</span>
                <span className="hm-a11y-secondary">{secondary}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
