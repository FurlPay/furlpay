// ---------------------------------------------------------------------------
// CI gate: no production path may import a synthetic travel-data generator.
//
//   node apps/web/scripts/check-no-synthetic-travel.mjs
//
// WHY A GATE AND NOT JUST A CLEANUP. generateStays() fabricated names, star
// ratings, review counts, photographs and nightly prices from a hash of the
// city name, and it reached seven live API routes — including the booking
// flow, where the amount a customer was charged came out of that hash. None of
// that was anyone's decision. It happened because the `Stay` type declares
// `nightlyUsd: number` as required, so a fabricated value was the only thing
// the compiler would accept, and a fabricated stay is indistinguishable from a
// real one at every layer above it.
//
// Deleting the calls fixes today. A gate fixes tomorrow: the next person to
// need a hotel-shaped object in a hurry finds the generator, and it is very
// convenient. This makes that a build failure instead of a silent regression.
//
// THE RULE. Files under src/app/api, src/app (pages) and src/lib — everything
// that can reach a user — may not import from the synthetic generators. Tests
// may: exercising the old shape is legitimate, and __tests__ never ships.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..", "src");

/** Named exports that invent travel records rather than reading them. */
const SYNTHETIC_EXPORTS = [
  "generateStays",
  "generateFlights",
  "generateActivities",
  "generateCars",
  "featuredDeals",
];

/** Only these may reference them. Everything else is a production path. */
const ALLOWED = [
  /[\\/]__tests__[\\/]/,
  /\.spec\.tsx?$/,
  /\.test\.tsx?$/,
  // The module that defines them, obviously.
  /[\\/]lib[\\/]travel[\\/]data\.ts$/,
];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
      yield full;
    }
  }
}

/** Blank out block and line comments, preserving line numbering. */
function stripComments(src) {
  const blank = (m) => m.replace(/[^\r\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\r\n]*/g, blank);
}

const offenders = [];

for (const file of walk(SRC)) {
  const rel = path.relative(path.resolve(HERE, "..", ".."), file).replace(/\\/g, "/");
  if (ALLOWED.some((re) => re.test(file))) continue;

  // Strip comments before matching. The gate is about what the code DOES, and
  // a comment explaining why a route no longer calls the generator is exactly
  // the documentation that stops the decision being quietly reversed — failing
  // CI on it would train people to delete the explanation.
  const text = stripComments(fs.readFileSync(file, "utf8"));
  for (const name of SYNTHETIC_EXPORTS) {
    // Imports and CALLS only - prose is left alone. An earlier version matched
    // the bare word and flagged the comments explaining why a route no longer
    // uses the generator, which punishes exactly the documentation that keeps
    // the decision from being quietly reversed.
    const re = new RegExp(
      String.raw`(^|[^\w])` + name + String.raw`\s*\(` +
        `|` +
        String.raw`import[^;]*` + name + String.raw`[^;]*from`,
      "m"
    );
    if (re.test(text)) {
      const line = text.split("\n").findIndex((l) => re.test(l)) + 1;
      offenders.push({ rel, name, line });
    }
  }
}

// -- THE RATCHET -----------------------------------------------------------
// Seventeen call sites remain, across subsystems this refactor has not reached
// yet - flights, cars, activities and deals, none of which have a real data
// source to migrate TO. Failing CI on them today would just mean the gate gets
// deleted within a week. So they are recorded as a baseline that may only
// shrink: a new offender fails the build, and an entry that has been fixed but
// left listed ALSO fails, so the list cannot rot into a permanent exemption.
const BASELINE_FILE = path.join(HERE, "synthetic-travel-baseline.json");
const baseline = fs.existsSync(BASELINE_FILE)
  ? new Set(JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")).known)
  : new Set();

const key = (o) => `${o.rel}#${o.name}`;
const current = new Set(offenders.map(key));
const added = offenders.filter((o) => !baseline.has(key(o)));
const fixed = [...baseline].filter((k) => !current.has(k));

if (added.length) {
  console.error("\n\n");
  for (const o of added) {
    console.error(`  ${o.rel}:${o.line}  references ${o.name}()`);
  }
  console.error(
    "\nThese generators fabricate names, ratings, review counts and nightly" +
      "\nprices from a hash seed. Nothing a user or a booking can see may come" +
      "\nfrom them. Use lib/travel/propertySource.ts, and render an honest" +
      "\nempty state where real data does not exist.\n"
  );
  process.exit(1);
}

if (fixed.length) {
  console.error("\n\n");
  for (const k of fixed) console.error(`  ${k}`);
  console.error("");
  process.exit(1);
}

console.log(
  offenders.length
    ? `no NEW synthetic travel data (${offenders.length} known, tracked in the baseline)`
    : "no production path references a synthetic travel generator"
);
