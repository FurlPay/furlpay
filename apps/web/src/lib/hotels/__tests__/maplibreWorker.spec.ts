import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// The MapLibre tile worker must be present, and must match the installed
// version.
//
// WHY THIS IS WORTH A TEST. MapLibre v6 resolves its worker from
// `import.meta.url`, which webpack rewrites inside a bundle, so its own
// resolver returns an empty string and it calls `new Worker("")`. That loads
// the HTML document as a worker script and fails silently: the map constructs,
// the canvas paints, the zoom controls work, tiles are fetched — and nothing is
// ever decoded. A completely blank map with a completely working interface.
//
// So the fix is a real URL served from public/, and the failure mode if that
// file goes missing or falls out of step is invisible in every other test:
// nothing throws, no route 404s, and the API keeps returning correct data.
// This is the only place that would notice.
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
// fileURLToPath, not URL.pathname: the repo lives under "Payment App", and a
// raw pathname keeps the %20 so every path built from it misses.
const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

function publicPath(file: string): string {
  return join(WEB_ROOT, "public", file);
}

describe("the MapLibre tile worker", () => {
  const pkgPath = require.resolve("maplibre-gl/package.json");
  const installed = JSON.parse(readFileSync(pkgPath, "utf8")).version as string;

  it("is served from public/, because webpack cannot resolve MapLibre's own path", () => {
    expect(
      existsSync(publicPath("maplibre-gl-worker.mjs")),
      "public/maplibre-gl-worker.mjs is missing — run: npm run sync:maplibre-worker"
    ).toBe(true);
  });

  it("matches the installed maplibre-gl exactly", () => {
    // A worker from a different release is a protocol mismatch with the main
    // thread, not a graceful degradation.
    const stamp = publicPath("maplibre-gl-worker.version");
    expect(existsSync(stamp), "version stamp missing — run: npm run sync:maplibre-worker").toBe(true);
    expect(readFileSync(stamp, "utf8").trim()).toBe(installed);
  });

  it("is a byte-for-byte copy of the shipped worker", () => {
    const source = join(dirname(pkgPath), "dist", "maplibre-gl-worker.mjs");
    expect(existsSync(source)).toBe(true);
    expect(readFileSync(publicPath("maplibre-gl-worker.mjs"))).toEqual(readFileSync(source));
  });

  it("is not an empty or truncated file", () => {
    // An interrupted copy would leave something that serves with a 200 and
    // still does nothing.
    expect(statSync(publicPath("maplibre-gl-worker.mjs")).size).toBeGreaterThan(1000);
  });

  it("is excluded from the middleware matcher", () => {
    // public/ files still pass through middleware when the matcher admits them,
    // and a worker that comes back as a redirect fails exactly as silently as a
    // missing one. `.mjs` has to be in the exclusion list.
    const middleware = readFileSync(join(WEB_ROOT, "src", "middleware.ts"), "utf8");
    const matcher = middleware.match(/"\/\(\(\?!.*?\)\.\*\)"/s)?.[0] ?? "";
    expect(matcher).toContain("mjs");
  });
});
