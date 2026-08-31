import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSaved,
  isSaved,
  onSavedChange,
  readSaved,
  readSavedIds,
  toggleSaved,
  type SavedPlace,
} from "../savedPlaces";

// ---------------------------------------------------------------------------
// The wishlist. Same posture as recentSearches: the store is untrusted input,
// and every accessor can throw. What is additionally true here is that several
// components render the same saved state at once — a heart in a hover card, a
// heart in the detail panel, a count on the map filter — so the broadcast is
// load-bearing rather than a convenience, and is tested as such.
// ---------------------------------------------------------------------------

const ATLANTIS = {
  id: "curated:atlantis-the-royal",
  name: "Atlantis The Royal",
  latitude: 25.1382,
  longitude: 55.1278,
  city: "Dubai",
  country: "United Arab Emirates",
};

const CLARIDGES = {
  id: "curated:claridges",
  name: "Claridge's",
  latitude: 51.5127,
  longitude: -0.1476,
  city: "London",
  country: "United Kingdom",
};

function installStore(throwOn: "none" | "write" | "everything" = "none") {
  const data = new Map<string, string>();
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const store = {
    getItem(k: string) {
      if (throwOn === "everything") throw new Error("blocked");
      return data.get(k) ?? null;
    },
    setItem(k: string, val: string) {
      if (throwOn !== "none") throw new Error("QuotaExceededError");
      data.set(k, val);
    },
    removeItem(k: string) {
      if (throwOn === "everything") throw new Error("blocked");
      data.delete(k);
    },
  };
  (globalThis as Record<string, unknown>).window = {
    localStorage: store,
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(e: { type: string }) {
      listeners.get(e.type)?.forEach((fn) => fn(e));
      return true;
    },
  };
  // The module builds one of these to broadcast; node has it, but the shape is
  // pinned here so the test does not depend on the runtime's version.
  (globalThis as Record<string, unknown>).CustomEvent = class {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
  return { data, raw: () => data.get("furlpay.hotels.saved") };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe("saved places", () => {
  describe("toggling", () => {
    beforeEach(() => installStore());

    it("starts empty", () => {
      expect(readSaved()).toEqual([]);
    });

    it("saves a place", () => {
      expect(toggleSaved(ATLANTIS).map((p) => p.id)).toEqual([ATLANTIS.id]);
      expect(isSaved(ATLANTIS.id)).toBe(true);
    });

    it("unsaves the same place", () => {
      toggleSaved(ATLANTIS);
      expect(toggleSaved(ATLANTIS)).toEqual([]);
      expect(isSaved(ATLANTIS.id)).toBe(false);
    });

    it("does not duplicate on a repeated save", () => {
      // A double-click must not race itself into two entries.
      toggleSaved(ATLANTIS);
      toggleSaved(ATLANTIS);
      toggleSaved(ATLANTIS);
      expect(readSaved()).toHaveLength(1);
    });

    it("keeps the newest save first", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      toggleSaved(ATLANTIS);
      vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
      toggleSaved(CLARIDGES);
      vi.useRealTimers();
      expect(readSaved().map((p) => p.name)).toEqual(["Claridge's", "Atlantis The Royal"]);
    });

    it("stamps when it was saved", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-04T05:06:07Z"));
      const [saved] = toggleSaved(ATLANTIS);
      vi.useRealTimers();
      expect(saved.savedAt).toBe(Date.parse("2026-03-04T05:06:07Z"));
    });

    it("exposes ids as a set for lookup during render", () => {
      toggleSaved(ATLANTIS);
      toggleSaved(CLARIDGES);
      const ids = readSavedIds();
      expect({ has: ids.has(ATLANTIS.id), size: ids.size }).toEqual({ has: true, size: 2 });
    });

    it("empties the list", () => {
      toggleSaved(ATLANTIS);
      expect(clearSaved()).toEqual([]);
      expect(readSaved()).toEqual([]);
    });

    it("refuses to save a malformed place", () => {
      const { raw } = installStore();
      toggleSaved({ ...ATLANTIS, latitude: Number.NaN });
      expect(raw()).toBeUndefined();
    });
  });

  describe("a store that cannot be trusted", () => {
    it("survives content that is not JSON", () => {
      const { data } = installStore();
      data.set("furlpay.hotels.saved", "not json");
      expect(readSaved()).toEqual([]);
    });

    it("survives JSON that is not an array", () => {
      const { data } = installStore();
      data.set("furlpay.hotels.saved", JSON.stringify({ id: "x" }));
      expect(readSaved()).toEqual([]);
    });

    it("drops an entry with an out-of-range coordinate", () => {
      const { data } = installStore();
      data.set(
        "furlpay.hotels.saved",
        JSON.stringify([
          { ...ATLANTIS, savedAt: 1 },
          { ...CLARIDGES, latitude: 900, savedAt: 2 },
        ])
      );
      expect(readSaved().map((p) => p.name)).toEqual(["Atlantis The Royal"]);
    });

    it("drops an entry from an older shape of this code", () => {
      const { data } = installStore();
      data.set(
        "furlpay.hotels.saved",
        JSON.stringify([{ hotelId: "x", lat: 25, lng: 55 }, { ...ATLANTIS, savedAt: 1 }])
      );
      expect(readSaved()).toHaveLength(1);
    });

    it("drops an entry with no name rather than rendering a blank row", () => {
      const { data } = installStore();
      data.set("furlpay.hotels.saved", JSON.stringify([{ ...ATLANTIS, name: "", savedAt: 1 }]));
      expect(readSaved()).toEqual([]);
    });
  });

  describe("a store that refuses to cooperate", () => {
    it("still returns the updated list when the write fails", () => {
      installStore("write");
      expect(toggleSaved(ATLANTIS).map((p) => p.id)).toEqual([ATLANTIS.id]);
    });

    it("reads as empty when the accessor itself throws", () => {
      installStore("everything");
      expect(readSaved()).toEqual([]);
    });
  });

  describe("broadcast", () => {
    it("notifies subscribers when the list changes", () => {
      // Load-bearing: two hearts for the same hotel can be on screen at once.
      installStore();
      const seen = vi.fn();
      const off = onSavedChange(seen);
      toggleSaved(ATLANTIS);
      expect(seen).toHaveBeenCalledTimes(1);
      toggleSaved(ATLANTIS);
      expect(seen).toHaveBeenCalledTimes(2);
      off();
    });

    it("stops notifying after unsubscribe", () => {
      installStore();
      const seen = vi.fn();
      onSavedChange(seen)();
      toggleSaved(ATLANTIS);
      expect(seen).not.toHaveBeenCalled();
    });

    it("hands back a no-op unsubscribe when there is no window", () => {
      // Server render: subscribing must be safe and tearing down must not throw.
      expect(() => onSavedChange(() => {})()).not.toThrow();
    });
  });

  it("reads as empty when there is no window at all", () => {
    expect(readSaved()).toEqual([]);
  });
});

describe("SavedPlace shape", () => {
  it("carries only what redrawing a pin needs", () => {
    // Photos, ratings and prices are deliberately NOT stored: they go stale,
    // and a wishlist showing a since-removed photo is worse than one that
    // refetches. Coordinates are kept because they do not change and without
    // them a saved place cannot be put back on a map.
    installStore();
    const [saved] = toggleSaved(ATLANTIS);
    const keys = Object.keys(saved).sort();
    expect(keys).toEqual(
      (["city", "country", "id", "latitude", "longitude", "name", "savedAt"] satisfies (keyof SavedPlace)[]).sort()
    );
  });
});
