#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Copy MapLibre's tile-parsing worker into public/.
//
// WHY THIS IS NECESSARY, precisely. MapLibre v6 resolves its own worker like
// this (from dist/maplibre-gl.mjs):
//
//     function wi() {
//       let e = import.meta.url;
//       if (!/^https?:/.test(e)) return ``;          // <- bails out
//       return new URL(`./maplibre-gl-worker.mjs`, e).href;
//     }
//
// Webpack rewrites `import.meta.url` to a non-http value inside a bundle, so
// that test fails and the resolver returns an EMPTY STRING. Downstream, an
// empty URL is not treated as an error:
//
//     let e = config.WORKER_URL || wi();
//     if (!isCrossOrigin(e)) return new Worker(e, { type: "module" });
//
// `new Worker("")` resolves against the current document, so the browser
// fetches the HTML page and tries to run it as a module worker. It fails
// silently. The map then initialises, the canvas appears, the controls work and
// tiles are fetched — and nothing is ever decoded, because the thing that
// decodes them never started. The result is a blank map with a working UI,
// which is exactly the symptom that is hard to trace back to a worker.
//
// The fix is to give MapLibre a real URL, and the most reliable way to have one
// in Next.js is to serve the file ourselves. `new URL("maplibre-gl/dist/...",
// import.meta.url)` does NOT work: webpack does not resolve bare package
// specifiers inside new URL(), so that produces a 404 at
// /_next/static/chunks/maplibre-gl/dist/maplibre-gl-worker.mjs.
//
// The file is 18KB and must match the installed maplibre-gl exactly — a worker
// from a different version is a protocol mismatch, not a graceful degradation —
// so this runs before dev and before build, and stamps the version it copied.
//
//   node apps/web/scripts/sync-maplibre-worker.mjs [--check]
// ---------------------------------------------------------------------------
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "..");
const PUBLIC_DIR = join(WEB_ROOT, "public");
const DEST = join(PUBLIC_DIR, "maplibre-gl-worker.mjs");
const STAMP = join(PUBLIC_DIR, "maplibre-gl-worker.version");

const CHECK_ONLY = process.argv.includes("--check");

const require = createRequire(import.meta.url);

let pkgPath;
try {
  pkgPath = require.resolve("maplibre-gl/package.json");
} catch {
  console.error("maplibre-gl is not installed — run npm install first.");
  process.exit(1);
}

const version = JSON.parse(readFileSync(pkgPath, "utf8")).version;
const source = join(dirname(pkgPath), "dist", "maplibre-gl-worker.mjs");

if (!existsSync(source)) {
  console.error(
    `maplibre-gl ${version} has no dist/maplibre-gl-worker.mjs.\n` +
      "The worker layout changed upstream; check how it is bundled before shipping."
  );
  process.exit(1);
}

const stamped = existsSync(STAMP) ? readFileSync(STAMP, "utf8").trim() : "";
const upToDate = existsSync(DEST) && stamped === version;

if (CHECK_ONLY) {
  if (upToDate) {
    console.log(`maplibre worker: up to date (${version})`);
    process.exit(0);
  }
  console.error(
    `maplibre worker is stale or missing (public has "${stamped || "nothing"}", installed is ${version}).\n` +
      "Run: node apps/web/scripts/sync-maplibre-worker.mjs"
  );
  process.exit(1);
}

if (upToDate) {
  console.log(`maplibre worker: already current (${version})`);
  process.exit(0);
}

mkdirSync(PUBLIC_DIR, { recursive: true });
copyFileSync(source, DEST);
// The stamp is what makes the next run a no-op, and what lets CI assert the
// copy has not drifted from the installed version.
writeFileSync(STAMP, `${version}\n`);

console.log(`maplibre worker: copied ${version} -> public/maplibre-gl-worker.mjs`);
