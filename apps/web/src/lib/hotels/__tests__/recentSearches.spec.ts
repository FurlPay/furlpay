import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Destination } from "@/components/travel/map/HotelMapSearchHeader";
import { clearRecent, pushRecent, readRecent } from "../recentSearches";

// ---------------------------------------------------------------------------
// Recent searches.
//
// The interesting behaviour is not "it remembers things" — it is what happens
// when the store lies. localStorage survives deploys and is writable by anything
// on the origin, so the module has to treat what comes back as untrusted input.
// A bad latitude that slips through does not throw; it flies the camera to the
// wrong hemisphere, which is why the validation is tested per field.
//
// The suite runs in the node environment, so `window` is installed here rather
// than assumed. That is also what lets the quota and blocked-store paths be
// exercised at all: a real browser will not fill its own quota on request.
// ---------------------------------------------------------------------------

const DUBAI: Destination = {
  label: "Dubai",
  sublabel: "United Arab Emirates",
  latitude: 25.2048,
  longitude: 55.2708,
  count: 34,
  kind: "destination",
};

const PARIS: Destination = {
  label: "Paris",
  sublabel: "France",
  latitude: 48.8566,
  longitude: 2.3522,
  count: 21,
  kind: "destination",
};

/** Minimal in-memory stand-in. `throwOn` forces the failure paths. */
function installStore(throwOn: "none" | "write" | "everything" = "none") {
  const data = new Map<string, string>();
  const store = {
    getItem(k: string) {
      if (throwOn === "everything") throw new Error("blocked");
      return data.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (throwOn !== "none") throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem(k: string) {
      if (throwOn === "everything") throw new Error("blocked");
      data.delete(k);
    },
  };
  (globalThis as { window?: unknown }).window = { localStorage: store };
  return { data, raw: () => data.get("furlpay.hotels.recent") };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("recent searches", () => {
  describe("round trip", () => {
    beforeEach(() => installStore());

    it("returns nothing before anything has been searched", () => {
      expect(readRecent()).toEqual([]);
    });

    it("puts the newest search at the front", () => {
      pushRecent(DUBAI);
      pushRecent(PARIS);
      expect(readRecent().map((d) => d.label)).toEqual(["Paris", "Dubai"]);
    });

    it("moves a repeated search back to the front instead of duplicating it", () => {
      pushRecent(DUBAI);
      pushRecent(PARIS);
      pushRecent(DUBAI);
      expect(readRecent().map((d) => d.label)).toEqual(["Dubai", "Paris"]);
    });

    it("treats the same coordinates as the same place however it is labelled", () => {
      // A destination row and a property row can name the same point in
      // different words. Two rows that move the camera to one place are one
      // recent search, so de-duplication is by position, not by text.
      pushRecent(DUBAI);
      pushRecent({ ...DUBAI, label: "Dubai, UAE", sublabel: "Emirate" });
      const got = readRecent();
      expect({ length: got.length, label: got[0]?.label }).toEqual({
        length: 1,
        label: "Dubai, UAE",
      });
    });

    it("keeps a property and a destination at the same point apart", () => {
      // Same coordinates, different `kind`: one zooms to a city, the other opens
      // a hotel. Collapsing them would lose a row the reader chose.
      pushRecent(DUBAI);
      pushRecent({ ...DUBAI, kind: "property" });
      expect(readRecent()).toHaveLength(2);
    });

    it("caps the list rather than growing without bound", () => {
      for (let i = 0; i < 20; i++) {
        pushRecent({ ...DUBAI, label: `Place ${i}`, latitude: i, longitude: i });
      }
      const got = readRecent();
      expect({ length: got.length, newest: got[0]?.label }).toEqual({
        length: 6,
        newest: "Place 19",
      });
    });

    it("empties the list", () => {
      pushRecent(DUBAI);
      expect(clearRecent()).toEqual([]);
      expect(readRecent()).toEqual([]);
    });
  });

  describe("a store that cannot be trusted", () => {
    it("survives content that is not JSON at all", () => {
      const { data } = installStore();
      data.set("furlpay.hotels.recent", "<!doctype html>");
      expect(readRecent()).toEqual([]);
    });

    it("survives JSON that is not an array", () => {
      const { data } = installStore();
      data.set("furlpay.hotels.recent", JSON.stringify({ label: "Dubai" }));
      expect(readRecent()).toEqual([]);
    });

    it("drops entries with a coordinate that is out of range", () => {
      const { data } = installStore();
      data.set(
        "furlpay.hotels.recent",
        JSON.stringify([DUBAI, { ...PARIS, latitude: 950 }])
      );
      expect(readRecent().map((d) => d.label)).toEqual(["Dubai"]);
    });

    it("drops entries whose coordinate is not a number", () => {
      // The failure this prevents: `null` coerces to 0 in arithmetic, so an
      // unchecked entry does not throw — it silently means Null Island.
      const { data } = installStore();
      data.set(
        "furlpay.hotels.recent",
        JSON.stringify([{ ...PARIS, longitude: null }, DUBAI])
      );
      expect(readRecent().map((d) => d.label)).toEqual(["Dubai"]);
    });

    it("drops entries left over from an older shape of this code", () => {
      const { data } = installStore();
      data.set(
        "furlpay.hotels.recent",
        JSON.stringify([{ name: "Dubai", lat: 25, lon: 55 }, DUBAI])
      );
      expect(readRecent().map((d) => d.label)).toEqual(["Dubai"]);
    });

    it("drops an unknown kind rather than rendering an icon for it", () => {
      const { data } = installStore();
      data.set("furlpay.hotels.recent", JSON.stringify([{ ...DUBAI, kind: "airport" }]));
      expect(readRecent()).toEqual([]);
    });

    it("refuses to write a malformed destination", () => {
      const { raw } = installStore();
      pushRecent({ ...DUBAI, latitude: Number.NaN });
      expect(raw()).toBeUndefined();
    });
  });

  describe("a store that refuses to cooperate", () => {
    it("still returns the updated list when the write fails", () => {
      // Full quota, or a browser set to block site data. The list is correct for
      // this session even though it will not outlive the tab — the feature
      // should degrade, not look broken until reload.
      installStore("write");
      expect(pushRecent(DUBAI).map((d) => d.label)).toEqual(["Dubai"]);
    });

    it("reads as empty when the accessor itself throws", () => {
      // Safari in private mode raises on the property access rather than
      // returning null, so the guard cannot be a null check.
      installStore("everything");
      expect(readRecent()).toEqual([]);
    });

    it("clears without throwing when removal is blocked", () => {
      installStore("everything");
      expect(clearRecent()).toEqual([]);
    });
  });

  it("returns an empty list when there is no window at all", () => {
    // Server render. This module is imported by a component the server touches,
    // so reaching for localStorage during render has to be impossible.
    expect(readRecent()).toEqual([]);
  });
});
