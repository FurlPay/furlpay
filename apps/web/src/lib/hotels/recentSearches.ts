import type { Destination } from "@/components/travel/map/HotelMapSearchHeader";

// ---------------------------------------------------------------------------
// Recent searches for the hotel map, persisted per browser.
//
// WHY LOCALSTORAGE AND NOT THE SERVER. A recent-search list is a convenience
// for one person on one device; it is not account state, nothing else reads it,
// and it must survive a reload without a round trip. There is also no endpoint
// that stores it, and inventing a fake one that silently drops writes would be
// worse than not having the feature.
//
// EVERYTHING HERE DISTRUSTS THE STORE. localStorage is writable by anything
// running on the origin and survives across deploys, so what comes back may be
// from an older shape of this code, hand-edited, or not JSON at all. Every read
// is parsed inside try/catch and then validated field by field; anything that
// does not survive validation is dropped rather than handed to the map, because
// a NaN in `latitude` would throw the camera to Null Island.
//
// Every access is also wrapped because the accessor ITSELF can throw — Safari
// in private mode and browsers set to block site data raise on the property
// access, not just on write. A failure here degrades to "no recent searches",
// which is a page that still works.
// ---------------------------------------------------------------------------

const KEY = "furlpay.hotels.recent";

/** Six is the most that fits above the fold without the list needing a scroll. */
const LIMIT = 6;

function isDestination(v: unknown): v is Destination {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.label === "string" && d.label.length > 0 && d.label.length <= 200 &&
    typeof d.sublabel === "string" && d.sublabel.length <= 200 &&
    typeof d.latitude === "number" && Number.isFinite(d.latitude) &&
    d.latitude >= -90 && d.latitude <= 90 &&
    typeof d.longitude === "number" && Number.isFinite(d.longitude) &&
    d.longitude >= -180 && d.longitude <= 180 &&
    typeof d.count === "number" && Number.isFinite(d.count) &&
    (d.kind === "destination" || d.kind === "property")
  );
}

/** Reads the list. Returns `[]` for every failure mode — never throws. */
export function readRecent(): Destination[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDestination).slice(0, LIMIT);
  } catch {
    return [];
  }
}

/**
 * Puts `d` at the front and returns the new list.
 *
 * Returns the list rather than relying on the caller re-reading, so the UI
 * updates even when the write itself failed — the in-memory list is correct for
 * this session either way, and a full quota should not make the feature look
 * broken until reload.
 *
 * De-duplication is by coordinate, not by label: the same place can arrive from
 * a destination row and from a property row with different text, and two rows
 * that fly the camera to the same point are the same recent search.
 */
export function pushRecent(d: Destination): Destination[] {
  if (!isDestination(d)) return readRecent();
  const same = (a: Destination) =>
    a.latitude === d.latitude && a.longitude === d.longitude && a.kind === d.kind;
  const next = [d, ...readRecent().filter((r) => !same(r))].slice(0, LIMIT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota, private mode, or a blocked store. The list is still right for this
    // session; it just will not outlive the tab.
  }
  return next;
}

/** Empties the list. Returns `[]` so callers can assign the result directly. */
export function clearRecent(): Destination[] {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — if it cannot be removed it could not have been written.
  }
  return [];
}
