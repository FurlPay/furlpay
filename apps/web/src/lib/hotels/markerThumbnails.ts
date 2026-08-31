// ---------------------------------------------------------------------------
// Circular photo thumbnails for map markers.
//
// Turns a property photograph into an ImageData a MapLibre symbol layer can
// draw, so a luxury property renders as the actual building rather than as a
// coloured dot. 141 of the 507 curated properties carry one.
//
// ── WHICH IMAGE, AND WHY IT MATTERS ────────────────────────────────────────
// `imageLocalPath` FIRST, always. Those files are served from our own origin,
// which buys three things a Commons hotlink cannot:
//
//   1. no cross-origin taint — a canvas that has drawn a cross-origin image
//      without CORS headers cannot be read back with getImageData(), and that
//      read is the entire point of this module;
//   2. no dependency on Commons' availability or hotlinking policy on a path
//      that runs for every marker in view;
//   3. predictable latency.
//
// The Commons URL is kept only as a fallback and is requested with
// `crossOrigin = "anonymous"`, so if it ever does get used and the response
// lacks CORS headers the load FAILS rather than silently poisoning the canvas.
//
// ── GOOGLE PLACES PHOTOS ARE NOT USABLE HERE ───────────────────────────────
// Deliberately not an input to this module. The Places policy permits their
// content on a Google map, or off a map entirely with attribution — not drawn
// as markers on a non-Google basemap. The hover card is where Places content
// belongs; see the note at the top of HotelMapHoverCard.
//
// ── ATTRIBUTION ────────────────────────────────────────────────────────────
// Every image is Wikimedia Commons under CC0/PD or a BY/BY-SA licence. A 44px
// marker has nowhere to carry a credit line, so attribution travels with the
// picture at the two places it can be read: the hover card prints the credit
// beside the photograph, and public/hotels/CREDITS.md lists every file. The
// marker is the thumbnail of a credited image, not an uncredited use.
//
// ── MEMORY ─────────────────────────────────────────────────────────────────
// Every registered image is GPU texture memory that MapLibre holds until it is
// explicitly removed. Panning a continent would otherwise accumulate them
// without bound, so the registry is an LRU capped at MAX_IMAGES and evicts on
// insert. Eviction is what makes this safe to run for a long session.
// ---------------------------------------------------------------------------

/** Rendered diameter in CSS pixels. */
export const THUMB_SIZE = 44;

/** Ring thickness in CSS pixels. Wide enough to read as a category colour. */
const RING = 3;

/** Drawn at 2x so the marker stays sharp on a HiDPI display. */
const SCALE = 2;

/**
 * How many thumbnails may be registered with the map at once.
 *
 * The render budget is 400 markers, of which only curated ones can have a
 * photo; 160 comfortably covers any single view while bounding what a long
 * panning session can accumulate.
 */
export const MAX_IMAGES = 160;

/** The id a feature's `icon-image` points at. */
export const thumbId = (propertyId: string) => `hm-thumb:${propertyId}`;

/**
 * Draws one circular thumbnail.
 *
 * Rejects rather than returning a placeholder: the caller's fallback is to
 * leave the marker as a circle, which is a correct rendering of "no photo" and
 * better than a grey disc that looks like a broken image.
 */
export async function renderCircularThumbnail(
  src: string,
  ringColor: string,
  signal?: AbortSignal
): Promise<ImageData> {
  const img = await loadImage(src, signal);

  const px = THUMB_SIZE * SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");

  ctx.scale(SCALE, SCALE);
  const c = THUMB_SIZE / 2;
  // The outer edge is inset by half the shadow blur so the shadow has room
  // inside the bitmap; MapLibre will not draw outside the icon's bounds.
  const outer = c - 2;
  const inner = outer - RING;

  // Ring, with a soft drop shadow. Drawn first so the photo clips inside it.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.arc(c, c, outer, 0, Math.PI * 2);
  ctx.fillStyle = ringColor;
  ctx.fill();
  ctx.restore();

  // Photo, centre-cropped to a square before it is scaled, so a wide landscape
  // shot is not squashed into the circle.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, inner, 0, Math.PI * 2);
  ctx.clip();
  const side = Math.min(img.width, img.height);
  ctx.drawImage(
    img,
    (img.width - side) / 2,
    (img.height - side) / 2,
    side,
    side,
    c - inner,
    c - inner,
    inner * 2,
    inner * 2
  );
  ctx.restore();

  return ctx.getImageData(0, 0, px, px);
}

function loadImage(src: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const img = new Image();
    // Same-origin paths are unaffected by this; a Commons fallback needs it, and
    // needs the load to FAIL rather than taint the canvas if CORS is missing.
    img.crossOrigin = "anonymous";

    const onAbort = () => {
      img.src = "";
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    img.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      // A zero-dimension decode would make drawImage throw further down.
      if (!img.width || !img.height) reject(new Error("empty image"));
      else resolve(img);
    };
    img.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(`could not load ${src}`));
    };
    img.src = src;
  });
}

/**
 * Which URL to draw for a property, or null when it has no usable photograph.
 *
 * `imageLocalPath` wins for the reasons at the top of this file. `imageThumbUrl`
 * is preferred over `imageUrl` among the remote options because it is already
 * width-limited — decoding a 4000px original to fill 44 pixels is waste the
 * browser cannot optimise away.
 */
export function thumbnailSource(p: {
  imageLocalPath?: string;
  imageThumbUrl?: string;
  imageUrl?: string;
}): string | null {
  return p.imageLocalPath ?? p.imageThumbUrl ?? p.imageUrl ?? null;
}

/**
 * The map's thumbnail registry: an LRU over `map.addImage` / `map.removeImage`.
 *
 * Deliberately NOT a plain Map of promises. Two things have to be true at once —
 * an id must never be requested twice concurrently, and the total must stay
 * bounded — and doing those separately is how you end up either double-loading
 * or evicting an image that a pending load is about to re-add.
 */
export class ThumbnailRegistry {
  /** Insertion-ordered: the first key is the least recently used. */
  private live = new Map<string, true>();
  private pending = new Map<string, AbortController>();
  private failed = new Set<string>();

  constructor(
    private map: {
      hasImage(id: string): boolean;
      addImage(id: string, image: ImageData, options?: { pixelRatio?: number }): void;
      removeImage(id: string): void;
    },
    private limit = MAX_IMAGES
  ) {}

  /**
   * The one step that needs a browser: canvas, Image decoding, getImageData.
   *
   * A `protected` method rather than a direct call to the module function, so
   * the bookkeeping either side of it — the LRU, the failure set, the
   * in-flight guard — can be tested in node without a DOM. That logic is where
   * the leaks and request loops live; the drawing is comparatively simple.
   */
  protected render(
    src: string,
    ringColor: string,
    signal: AbortSignal
  ): Promise<ImageData> {
    return renderCircularThumbnail(src, ringColor, signal);
  }

  /**
   * Ensure `id` is registered, loading it if needed.
   *
   * Safe to call repeatedly for the same id — a second call while the first is
   * in flight is a no-op, and an id that has already failed is never retried.
   * Retrying a 404 on every repaint would be an unbounded request loop.
   */
  async ensure(id: string, src: string, ringColor: string): Promise<boolean> {
    if (this.failed.has(id)) return false;
    if (this.live.has(id)) {
      this.touch(id);
      return true;
    }
    if (this.pending.has(id)) return false;

    const ac = new AbortController();
    this.pending.set(id, ac);
    try {
      const data = await this.render(src, ringColor, ac.signal);
      if (ac.signal.aborted) return false;
      // `hasImage` guards a race: the style can be reloaded, or another path can
      // register the same id, while this await was outstanding.
      if (!this.map.hasImage(id)) {
        this.map.addImage(id, data, { pixelRatio: SCALE });
      }
      this.live.set(id, true);
      this.evict();
      return true;
    } catch {
      // Aborts are ordinary teardown and must not poison the id for the session.
      if (!ac.signal.aborted) this.failed.add(id);
      return false;
    } finally {
      this.pending.delete(id);
    }
  }

  private touch(id: string) {
    this.live.delete(id);
    this.live.set(id, true);
  }

  private evict() {
    while (this.live.size > this.limit) {
      const oldest = this.live.keys().next().value;
      if (oldest === undefined) return;
      this.live.delete(oldest);
      try {
        if (this.map.hasImage(oldest)) this.map.removeImage(oldest);
      } catch {
        // The style may have been swapped underneath us; the entry is already
        // out of `live`, so the registry stays consistent either way.
      }
    }
  }

  /** Cancel every in-flight load and forget everything. For unmount. */
  dispose() {
    for (const ac of this.pending.values()) ac.abort();
    this.pending.clear();
    this.live.clear();
    this.failed.clear();
  }

  /** Registered count — for tests and diagnostics. */
  get size() {
    return this.live.size;
  }
}
