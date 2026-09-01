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
// THE WORKER IS NOT ONE FILE. As of v6 it is an ES module that begins
//
//     import{...}from"./maplibre-gl-shared.mjs"
//
// and copying only the entry point produces the SAME blank map as having no
// worker at all: /maplibre-gl-worker.mjs resolves, its sibling 404s, the module
// never instantiates, and nothing is ever decoded. That failure is worse than
// the original because the worker file is plainly there when you go looking.
//
// So this follows the entry point's relative imports transitively and copies
// the whole graph, rather than naming the second file — if upstream splits the
// bundle again, the next chunk comes along automatically instead of shipping
// another silently blank map.
//
//   node apps/web/scripts/sync-maplibre-worker.mjs [--check]
// ---------------------------------------------------------------------------
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
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

/**
 * The worker entry point plus every relative module it pulls in, transitively.
 *
 * Returned as absolute source paths. The names are preserved on copy because
 * the import specifiers inside the files are relative and are not rewritten —
 * `./maplibre-gl-shared.mjs` has to resolve to a sibling of the worker at the
 * URL it is served from, which is the root of public/.
 */
function workerGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    // Matches both `from"./x.mjs"` (minified) and `from "./x.mjs"`, plus the
    // bare `import"./x.mjs"` side-effect form.
    for (const m of src.matchAll(/(?:from|import)\s*["'](\.\/[^"']+)["']/g)) {
      const dep = join(dirname(file), m[1]);
      if (!existsSync(dep)) {
        console.error(
          `${file} imports ${m[1]}, which does not exist in the maplibre-gl package.\n` +
            "The worker's module layout changed upstream; check it before shipping."
        );
        process.exit(1);
      }
      queue.push(dep);
    }
  }
  return [...seen];
}

const graph = workerGraph(source);

const stamped = existsSync(STAMP) ? readFileSync(STAMP, "utf8").trim() : "";
// Every file in the graph has to be present, not just the entry point — a
// public/ carrying the worker but not its sibling is precisely the state this
// script exists to prevent, and it must not be reported as up to date.
const allPresent = graph.every((f) => existsSync(join(PUBLIC_DIR, basename(f))));
const upToDate = allPresent && stamped === version;

if (CHECK_ONLY) {
  if (upToDate) {
    console.log(`maplibre worker: up to date (${version})`);
    process.exit(0);
  }
  const missing = graph.map((f) => basename(f)).filter((n) => !existsSync(join(PUBLIC_DIR, n)));
  console.error(
    `maplibre worker is stale or missing (public has "${stamped || "nothing"}", installed is ${version}).\n` +
      // Naming the file matters: a stale *stamp* and a missing *chunk* both land
      // here, and they are fixed by the same command but mean different things.
      (missing.length ? `Missing from public/: ${missing.join(", ")}\n` : "") +
      "Run: node apps/web/scripts/sync-maplibre-worker.mjs"
  );
  process.exit(1);
}

if (upToDate) {
  console.log(`maplibre worker: already current (${version})`);
  process.exit(0);
}

mkdirSync(PUBLIC_DIR, { recursive: true });
for (const file of graph) {
  copyFileSync(file, join(PUBLIC_DIR, basename(file)));
}
// The stamp is what makes the next run a no-op, and what lets CI assert the
// copy has not drifted from the installed version.
writeFileSync(STAMP, `${version}\n`);

console.log(
  `maplibre worker: copied ${version} -> public/ (${graph.map((f) => basename(f)).join(", ")})`
);
