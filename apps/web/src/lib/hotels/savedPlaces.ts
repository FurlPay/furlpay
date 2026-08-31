// ---------------------------------------------------------------------------
// Saved hotels, per browser.
//
// WHY LOCALSTORAGE AND NOT AN ACCOUNT. There is no endpoint that stores a
// wishlist, and the map is reachable signed-out. Writing to a table that does
// not exist, or silently dropping saves for signed-out readers, would both be
// worse than a list that lives in this browser and says so. When a real
// endpoint exists this module is the single place that has to change — nothing
// else touches the store.
//
// WHAT IS STORED, AND WHY THAT MUCH. Enough to redraw the pin and open the
// property WITHOUT a network round trip: id, name, coordinates, city, country.
// Not the photo, rating or description — those go stale, and a wishlist that
// shows last month's price or a since-removed photo is worse than one that
// refetches. Coordinates are the exception because they do not change and
// without them a saved place cannot be put back on a map.
//
// EVERYTHING HERE DISTRUSTS THE STORE, for the reasons set out at length in
// recentSearches.ts: localStorage survives deploys, is writable by anything on
// the origin, and its accessor can itself throw in private mode.
//
// CHANGES ARE BROADCAST. The heart in a hover card, the heart in the detail
// panel and the map's Saved filter can all be showing the same property at
// once. They subscribe to one event rather than polling, so toggling any of
// them updates the others in the same frame.
// ---------------------------------------------------------------------------

const KEY = "furlpay.hotels.saved";

/** Fired on this tab whenever the list changes. */
const EVENT = "furlpay:saved-places";

/**
 * A generous cap that still bounds the store.
 *
 * localStorage is a few megabytes per origin shared with everything else the
 * app keeps there, so an unbounded list is a slow leak that eventually breaks
 * an unrelated feature's write rather than this one's.
 */
const LIMIT = 500;

export interface SavedPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
  /** When it was saved, epoch ms — the list is shown newest first. */
  savedAt: number;
}

function isSavedPlace(v: unknown): v is SavedPlace {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" && p.id.length > 0 && p.id.length <= 200 &&
    typeof p.name === "string" && p.name.length > 0 && p.name.length <= 300 &&
    typeof p.latitude === "number" && Number.isFinite(p.latitude) &&
    p.latitude >= -90 && p.latitude <= 90 &&
    typeof p.longitude === "number" && Number.isFinite(p.longitude) &&
    p.longitude >= -180 && p.longitude <= 180 &&
    typeof p.city === "string" && p.city.length <= 200 &&
    typeof p.country === "string" && p.country.length <= 200 &&
    typeof p.savedAt === "number" && Number.isFinite(p.savedAt)
  );
}

/** Reads the list, newest first. Returns `[]` for every failure — never throws. */
export function readSaved(): SavedPlace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSavedPlace)
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

/** The saved ids, for the O(1) lookup a render pass needs. */
export function readSavedIds(): Set<string> {
  return new Set(readSaved().map((p) => p.id));
}

function write(list: SavedPlace[]): SavedPlace[] {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota, private mode, or a blocked store. The returned list is still right
    // for this session; it just will not outlive the tab.
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // No CustomEvent in this environment. Callers that hold their own copy of
    // the returned list are unaffected; only cross-component sync is lost.
  }
  return list;
}

/**
 * Adds the place if it is absent, removes it if present. Returns the new list.
 *
 * A toggle rather than separate add/remove because that is what one heart
 * button does, and splitting it would let a double-click race itself into a
 * duplicate entry.
 */
export function toggleSaved(place: Omit<SavedPlace, "savedAt">): SavedPlace[] {
  const current = readSaved();
  const existing = current.some((p) => p.id === place.id);
  if (existing) return write(current.filter((p) => p.id !== place.id));

  const next: SavedPlace = { ...place, savedAt: Date.now() };
  if (!isSavedPlace(next)) return current;
  // Newest first, and the cap drops the OLDEST rather than refusing the new
  // save — a wishlist that silently stops accepting entries is a dead control.
  return write([next, ...current].slice(0, LIMIT));
}

export function isSaved(id: string): boolean {
  return readSaved().some((p) => p.id === id);
}

/** Empties the list. Returns `[]` so callers can assign the result directly. */
export function clearSaved(): SavedPlace[] {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // If it cannot be removed it could not have been written.
  }
  return write([]);
}

/**
 * Subscribe to changes. Returns an unsubscribe function.
 *
 * Two sources, because they cover different things: the custom event catches
 * changes made in THIS tab, and `storage` catches changes made in another one —
 * `storage` deliberately does not fire in the tab that caused it.
 */
export function onSavedChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) fn();
  };
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", onStorage);
  };
}
