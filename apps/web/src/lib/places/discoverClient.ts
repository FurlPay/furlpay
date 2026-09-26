import type { GooglePlace } from "@/lib/hotels/googlePlaces";
import type { Viewport } from "@/lib/places/viewportDiscovery";

// ---------------------------------------------------------------------------
// Browser-side client for POST /api/places/discover.
//
// Thin on purpose. The key, the field masks and the area cap all live on the
// server; this only shapes the request and classifies the outcome so the map
// can say something truthful about the layer's state.
// ---------------------------------------------------------------------------

export type LiveStatus =
  /** Not attempted yet this session. */
  | "idle"
  /** Live results are being shown. */
  | "live"
  /** Asked, got nothing. The area genuinely has no matching places. */
  | "empty"
  /** Viewport too coarse to ask. The user needs to zoom, not to worry. */
  | "zoom-in"
  /** The API is not configured or not enabled on the project. */
  | "unavailable"
  /** Rate-limited, upstream error, or the network failed. */
  | "degraded";

export interface LiveResult {
  places: GooglePlace[];
  status: LiveStatus;
}

const EMPTY: GooglePlace[] = [];

/**
 * Discover live places for a viewport.
 *
 * NEVER throws and never rejects. The map's indexed results are already on
 * screen by the time this runs, so any failure here must degrade to "the live
 * layer is quiet" rather than taking down a working map.
 */
export async function discoverLive(
  viewport: Viewport,
  query: string | undefined,
  signal: AbortSignal
): Promise<LiveResult> {
  try {
    const res = await fetch("/api/places/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        viewport,
        kinds: ["hotels"],
        // Passed through to Text Search so a typed brand narrows the live
        // query too, not just the local filter over already-loaded points.
        ...(query ? { query } : {}),
      }),
      signal,
    });

    if (res.status === 422) return { places: EMPTY, status: "zoom-in" };
    // 503 is "not configured"; 403 upstream surfaces here once the route maps it.
    if (res.status === 503) return { places: EMPTY, status: "unavailable" };
    if (!res.ok) return { places: EMPTY, status: "degraded" };

    const data = (await res.json()) as {
      hotels?: { places?: GooglePlace[]; unavailable?: boolean };
      degraded?: boolean;
    };

    if (data.hotels?.unavailable || data.degraded) {
      return { places: EMPTY, status: "unavailable" };
    }

    const places = data.hotels?.places ?? [];
    return { places, status: places.length ? "live" : "empty" };
  } catch (e) {
    // An abort is the map doing its job, not a failure to report.
    if (signal.aborted || (e as Error)?.name === "AbortError") {
      return { places: EMPTY, status: "idle" };
    }
    return { places: EMPTY, status: "degraded" };
  }
}

/** Short, non-alarming text for the map's status line. Never leaks internals. */
export function liveStatusLabel(s: LiveStatus): string | null {
  switch (s) {
    case "live":
    case "empty":
    case "idle":
      return null; // nothing worth saying
    case "zoom-in":
      return "Zoom in to discover more places here";
    case "unavailable":
      return "Live place discovery is unavailable";
    case "degraded":
      return "Live place discovery is temporarily unavailable";
  }
}
