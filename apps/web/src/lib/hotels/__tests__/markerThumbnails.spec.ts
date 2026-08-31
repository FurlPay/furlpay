import { describe, expect, it, vi } from "vitest";
import { MAX_IMAGES, ThumbnailRegistry, thumbId, thumbnailSource } from "../markerThumbnails";

// ---------------------------------------------------------------------------
// The thumbnail registry.
//
// Canvas rendering itself needs a browser and is exercised there. What is
// testable — and what actually carries risk — is the bookkeeping around it:
//
//   * every registered image is GPU texture memory MapLibre holds until it is
//     explicitly removed, so an LRU that fails to evict is a leak that grows
//     for as long as someone keeps panning;
//   * `styleimagemissing` fires on EVERY repaint for an unresolved icon, so an
//     id that 404s must be remembered as failed or it becomes a request loop;
//   * the same id can be requested twice before the first load resolves.
//
// `renderCircularThumbnail` is mocked because it is the browser half; the
// registry's own logic is the subject.
// ---------------------------------------------------------------------------

/** A stand-in for the parts of the MapLibre map the registry touches. */
function fakeMap() {
  const images = new Set<string>();
  return {
    images,
    hasImage: (id: string) => images.has(id),
    addImage: (id: string) => {
      images.add(id);
    },
    removeImage: (id: string) => {
      images.delete(id);
    },
  };
}

/**
 * A registry whose renderer is controllable.
 *
 * The real `ensure` calls the module-level renderer; rather than mock across a
 * module boundary, the subclass overrides the one seam that needs a browser.
 */
class TestRegistry extends ThumbnailRegistry {
  constructor(
    map: ReturnType<typeof fakeMap>,
    private behaviour: (src: string) => Promise<void>,
    limit?: number
  ) {
    super(map, limit);
  }
  protected override async render(src: string): Promise<ImageData> {
    await this.behaviour(src);
    return {} as ImageData;
  }
}

describe("thumbnailSource", () => {
  it("prefers the local file over anything remote", () => {
    // Local files are same-origin, so the canvas can be read back. A remote
    // image without CORS headers taints the canvas and getImageData throws —
    // and that read is the entire point of the module.
    expect(
      thumbnailSource({
        imageLocalPath: "/hotels/boutique/x.jpg",
        imageThumbUrl: "https://commons.wikimedia.org/thumb.jpg",
        imageUrl: "https://commons.wikimedia.org/full.jpg",
      })
    ).toBe("/hotels/boutique/x.jpg");
  });

  it("prefers the width-limited thumb over the original", () => {
    // Decoding a 4000px original to fill 44 pixels is waste the browser cannot
    // optimise away.
    expect(
      thumbnailSource({
        imageThumbUrl: "https://commons.wikimedia.org/thumb.jpg",
        imageUrl: "https://commons.wikimedia.org/full.jpg",
      })
    ).toBe("https://commons.wikimedia.org/thumb.jpg");
  });

  it("falls back to the original when that is all there is", () => {
    expect(thumbnailSource({ imageUrl: "https://commons.wikimedia.org/full.jpg" })).toBe(
      "https://commons.wikimedia.org/full.jpg"
    );
  });

  it("returns null for a property with no photograph", () => {
    // 366 of the 507 curated properties are in this case; they render as
    // circles, which is a correct drawing of "no photo".
    expect(thumbnailSource({})).toBeNull();
  });
});

describe("thumbId", () => {
  it("namespaces the id so it cannot collide with a basemap sprite", () => {
    expect(thumbId("curated:atlantis")).toBe("hm-thumb:curated:atlantis");
  });
});

describe("ThumbnailRegistry", () => {
  const ok = () => Promise.resolve();
  const fail = () => Promise.reject(new Error("404"));

  it("registers an image with the map", async () => {
    const map = fakeMap();
    const r = new TestRegistry(map, ok);
    await r.ensure("a", "/a.jpg", "#fff");
    expect({ registered: map.images.has("a"), size: r.size }).toEqual({
      registered: true,
      size: 1,
    });
  });

  it("does not reload an image it already holds", async () => {
    const map = fakeMap();
    const render = vi.fn(ok);
    const r = new TestRegistry(map, render);
    await r.ensure("a", "/a.jpg", "#fff");
    await r.ensure("a", "/a.jpg", "#fff");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("does not start a second load while the first is in flight", async () => {
    // styleimagemissing can fire twice for one id before either resolves.
    const map = fakeMap();
    const render = vi.fn(() => new Promise<void>((res) => setTimeout(res, 5)));
    const r = new TestRegistry(map, render);
    const both = Promise.all([r.ensure("a", "/a.jpg", "#fff"), r.ensure("a", "/a.jpg", "#fff")]);
    await both;
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("never retries an id that failed", async () => {
    // The event fires on every repaint for an unresolved icon. Without this a
    // single 404 becomes an unbounded request loop.
    const map = fakeMap();
    const render = vi.fn(fail);
    const r = new TestRegistry(map, render);
    await r.ensure("gone", "/gone.jpg", "#fff");
    await r.ensure("gone", "/gone.jpg", "#fff");
    await r.ensure("gone", "/gone.jpg", "#fff");
    expect({ calls: render.mock.calls.length, size: r.size }).toEqual({ calls: 1, size: 0 });
  });

  it("reports failure to the caller rather than throwing", async () => {
    const r = new TestRegistry(fakeMap(), fail);
    await expect(r.ensure("gone", "/gone.jpg", "#fff")).resolves.toBe(false);
  });

  describe("eviction", () => {
    it("stays at the limit rather than growing without bound", async () => {
      // Every image held is GPU memory; panning a continent would otherwise
      // accumulate them for the life of the session.
      const map = fakeMap();
      const r = new TestRegistry(map, ok, 3);
      for (const id of ["a", "b", "c", "d", "e"]) {
        await r.ensure(id, `/${id}.jpg`, "#fff");
      }
      expect({ size: r.size, mapHolds: map.images.size }).toEqual({ size: 3, mapHolds: 3 });
    });

    it("removes the evicted image from the map, not just the ledger", async () => {
      // Dropping the entry without calling removeImage is the leak this whole
      // class exists to prevent.
      const map = fakeMap();
      const r = new TestRegistry(map, ok, 2);
      await r.ensure("a", "/a.jpg", "#fff");
      await r.ensure("b", "/b.jpg", "#fff");
      await r.ensure("c", "/c.jpg", "#fff");
      expect(map.images.has("a")).toBe(false);
    });

    it("evicts the least recently used, not the oldest inserted", async () => {
      const map = fakeMap();
      const r = new TestRegistry(map, ok, 2);
      await r.ensure("a", "/a.jpg", "#fff");
      await r.ensure("b", "/b.jpg", "#fff");
      // Re-requesting "a" makes it the most recent, so "b" should go next.
      await r.ensure("a", "/a.jpg", "#fff");
      await r.ensure("c", "/c.jpg", "#fff");
      expect({ a: map.images.has("a"), b: map.images.has("b"), c: map.images.has("c") }).toEqual({
        a: true,
        b: false,
        c: true,
      });
    });

    it("survives a removeImage that throws", async () => {
      // The style can be swapped underneath us mid-session.
      const map = fakeMap();
      map.removeImage = () => {
        throw new Error("style reloaded");
      };
      const r = new TestRegistry(map, ok, 1);
      await r.ensure("a", "/a.jpg", "#fff");
      await expect(r.ensure("b", "/b.jpg", "#fff")).resolves.toBe(true);
      expect(r.size).toBe(1);
    });

    it("has a default limit that bounds a long session", () => {
      expect(MAX_IMAGES).toBeLessThanOrEqual(400);
      expect(MAX_IMAGES).toBeGreaterThan(0);
    });
  });

  describe("dispose", () => {
    it("forgets everything", async () => {
      const r = new TestRegistry(fakeMap(), ok);
      await r.ensure("a", "/a.jpg", "#fff");
      r.dispose();
      expect(r.size).toBe(0);
    });

    it("lets a failed id be tried again after disposal", async () => {
      // A fresh mount is a fresh chance; the failure set is session state, not
      // a permanent verdict about the file.
      const map = fakeMap();
      const render = vi.fn(fail);
      const r = new TestRegistry(map, render);
      await r.ensure("gone", "/gone.jpg", "#fff");
      r.dispose();
      await r.ensure("gone", "/gone.jpg", "#fff");
      expect(render).toHaveBeenCalledTimes(2);
    });
  });
});
