import { describe, it, expect } from "vitest";
import {
  MAX_AVATAR_BYTES,
  isAllowedAvatarUrl,
  isOwnedAvatarDataUrl,
} from "@/lib/profileAvatar";
import { centreSquare, dataUrlBytes } from "@/components/user/ProfileImageUploader";

// ---------------------------------------------------------------------------
// The avatar field is rendered in an <img> on every page of the app, so what
// may be stored in it is a security question rather than a formatting one.
// These tests are the server-side gate: the browser's crop is a convenience,
// and anyone can POST whatever they like to the endpoint.
// ---------------------------------------------------------------------------

/** A syntactically valid data URL with the given media type and leading bytes. */
function dataUrl(mediaType: string, bytes: number[], padTo = 64): string {
  const buf = Buffer.concat([Buffer.from(bytes), Buffer.alloc(Math.max(0, padTo - bytes.length), 1)]);
  return `data:${mediaType};base64,${buf.toString("base64")}`;
}

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

describe("uploaded avatar validation", () => {
  it("accepts the three raster formats we produce", () => {
    expect(isOwnedAvatarDataUrl(dataUrl("image/jpeg", JPEG))).toBe(true);
    expect(isOwnedAvatarDataUrl(dataUrl("image/png", PNG))).toBe(true);
    expect(isOwnedAvatarDataUrl(dataUrl("image/webp", WEBP))).toBe(true);
  });

  it("rejects SVG outright", () => {
    // SVG is a document format that can carry script. <img> will not execute
    // it, but the same stored string would if it were ever opened directly.
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`;
    expect(isOwnedAvatarDataUrl(svg)).toBe(false);
    expect(isAllowedAvatarUrl(svg)).toBe(false);
  });

  it("rejects a payload whose bytes do not match its declared type", () => {
    // Without the magic-byte check this endpoint stores arbitrary bytes behind
    // an image label.
    const lie = `data:image/png;base64,${Buffer.from("<html><script>x</script>").toString("base64")}`;
    expect(isOwnedAvatarDataUrl(lie)).toBe(false);

    // A real JPEG mislabelled as PNG is also refused — the pair must agree.
    expect(isOwnedAvatarDataUrl(dataUrl("image/png", JPEG))).toBe(false);
  });

  it("rejects RIFF containers that are not WEBP", () => {
    // "RIFF" alone is also AVI and WAV.
    const avi = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20];
    expect(isOwnedAvatarDataUrl(dataUrl("image/webp", avi))).toBe(false);
  });

  it("enforces a decoded size ceiling", () => {
    const tooBig = dataUrl("image/jpeg", JPEG, MAX_AVATAR_BYTES + 1024);
    expect(isOwnedAvatarDataUrl(tooBig)).toBe(false);

    const fits = dataUrl("image/jpeg", JPEG, MAX_AVATAR_BYTES - 1024);
    expect(isOwnedAvatarDataUrl(fits)).toBe(true);
  });

  it("rejects an empty payload", () => {
    expect(isOwnedAvatarDataUrl("data:image/jpeg;base64,")).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "not a url",
      "data:image/jpeg;base64,!!!!not base64!!!!",
      "data:image/jpeg,plaintext",
      "javascript:alert(1)",
    ]) {
      expect(() => isOwnedAvatarDataUrl(bad as string)).not.toThrow();
      expect(isOwnedAvatarDataUrl(bad as string)).toBe(false);
    }
  });

  it("still refuses an arbitrary remote host", () => {
    // The original reason the allowlist exists: this field renders in an <img>
    // on every page, so an arbitrary URL is a tracking pixel someone else owns.
    expect(isAllowedAvatarUrl("https://evil.example.com/a.png")).toBe(false);
    expect(isAllowedAvatarUrl("http://lh3.googleusercontent.com/a")).toBe(false);
    expect(isAllowedAvatarUrl("https://lh3.googleusercontent.com/a")).toBe(true);
  });

  it("accepts an owned data URL through the general checker too", () => {
    expect(isAllowedAvatarUrl(dataUrl("image/jpeg", JPEG))).toBe(true);
  });
});

describe("client-side crop arithmetic", () => {
  it("takes the largest centred square", () => {
    // Landscape: crop the sides.
    expect(centreSquare(1000, 600)).toEqual({ sx: 200, sy: 0, size: 600 });
    // Portrait: crop top and bottom.
    expect(centreSquare(600, 1000)).toEqual({ sx: 0, sy: 200, size: 600 });
    // Already square: no crop at all.
    expect(centreSquare(500, 500)).toEqual({ sx: 0, sy: 0, size: 500 });
  });

  it("never produces a negative offset on an odd dimension", () => {
    const r = centreSquare(101, 100);
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sy).toBeGreaterThanOrEqual(0);
    expect(r.size).toBe(100);
  });

  it("measures a data URL without decoding it", () => {
    const buf = Buffer.alloc(300, 7);
    const url = `data:image/jpeg;base64,${buf.toString("base64")}`;
    expect(dataUrlBytes(url)).toBe(300);
    expect(dataUrlBytes("nope")).toBe(0);
  });
});
