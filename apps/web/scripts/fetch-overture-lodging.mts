#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Download lodging from Overture Maps Foundation into a seed JSONL file.
//
//   node --experimental-strip-types scripts/fetch-overture-lodging.mts \
//     --country SG --limit 5000 --output seeds/overture-sg.jsonl
//
//   node --experimental-strip-types scripts/fetch-overture-lodging.mts \
//     --bbox 103.6,1.2,104.0,1.5 --output seeds/overture-sg-bbox.jsonl --pipe
//
// WHY DuckDB AND NOT A NODE PARQUET READER
// Overture publishes ~400GB of Parquet per release, partitioned by theme. The
// only practical way to pull a country's lodging out of it is a predicate
// pushdown that reads the relevant row groups over HTTP range requests and
// nothing else. DuckDB does that natively; a Node Parquet library would stream
// the whole partition. So this script SHELLS OUT to the DuckDB CLI rather than
// adding a heavy dependency to apps/web — the harvest is an operator task run
// occasionally, not something the web app does.
//
// NO CREDENTIALS NEEDED. The Overture bucket is public and anonymous reads are
// permitted; s3_region is set because DuckDB needs to know where to address,
// not because anything is authenticated.
//
// LICENSING. Overture Places is CDLA-Permissive 2.0 — commercial use, no
// attribution obligation on the data itself. Rows Overture sourced from OSM
// carry ODbL downstream, so `sources` is preserved into the seed file.
//
// NO CRAWLING, NO SEARCH-ENGINE HARVESTING, NO BOT EVASION. This reads a
// published open-data release. That boundary is deliberate and it is why this
// script can be run at any scale without a legal review each time.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildOvertureQuery, normalizeBatch, type OvertureRecord } from "../src/lib/hotels/overture.ts";

const args = process.argv.slice(2);
function flag(name: string, fallback = ""): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function die(msg: string): never {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

const COUNTRY = flag("country").toUpperCase();
const BBOX_RAW = flag("bbox");
const OUTPUT = flag("output");
const PIPE = args.includes("--pipe");
// Overture cuts a release monthly; pin it so a harvest is reproducible rather
// than silently changing under you.
const RELEASE = flag("release", "2026-08-20.0");
const LIMIT = Math.max(1, Math.min(2_000_000, Number(flag("limit", "10000")) || 10000));

if (!OUTPUT) die("--output <path.jsonl> is required.");
if (!COUNTRY && !BBOX_RAW) die("One of --country <ISO-2> or --bbox <minLng,minLat,maxLng,maxLat> is required.");

// Both of these are interpolated into SQL as literals (the DuckDB CLI has no
// bind parameters over -c), so they are validated to a strict shape HERE. A
// country code that is not two letters, or a bbox component that is not a
// finite number, never reaches the query string.
if (COUNTRY && !/^[A-Z]{2}$/.test(COUNTRY)) {
  die(`--country must be an ISO-3166 alpha-2 code, got "${COUNTRY}".`);
}

let bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number } | undefined;
if (BBOX_RAW) {
  const parts = BBOX_RAW.split(",").map((n) => Number(n.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    die(`--bbox must be four numbers: minLng,minLat,maxLng,maxLat (got "${BBOX_RAW}").`);
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) die("--bbox is outside valid coordinate ranges.");
  if (minLng >= maxLng || minLat >= maxLat) die("--bbox min values must be less than max values.");
  bbox = { minLng, minLat, maxLng, maxLat };
}

// --- locate DuckDB -----------------------------------------------------------

const probe = spawnSync("duckdb", ["--version"], { encoding: "utf8" });
if (probe.error || probe.status !== 0) {
  die(
    `DuckDB CLI not found on PATH.\n` +
      `  This script reads Overture's public Parquet release directly, which needs DuckDB.\n` +
      `  Install:  https://duckdb.org/docs/installation/\n` +
      `    macOS   brew install duckdb\n` +
      `    Windows winget install DuckDB.cli\n` +
      `    Linux   curl https://install.duckdb.org | sh`
  );
}

const sql = buildOvertureQuery({ release: RELEASE, country: COUNTRY || undefined, bbox, limit: LIMIT });

console.log(`\nOverture release : ${RELEASE}`);
console.log(`Filter           : ${COUNTRY ? `country=${COUNTRY}` : `bbox=${BBOX_RAW}`}  limit=${LIMIT}`);
console.log(`DuckDB           : ${(probe.stdout || "").trim()}`);
console.log(`\nScanning Parquet over HTTP — the first run downloads row-group metadata and can take a few minutes.\n`);

// -json makes DuckDB emit an array of objects, which is what normalizeBatch
// expects. stdout is capped generously; a country's lodging is tens of MB.
const run = spawnSync("duckdb", ["-json", "-c", sql], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 1024,
});

if (run.status !== 0) {
  die(`DuckDB query failed:\n${(run.stderr || "").slice(0, 2000)}`);
}

let rows: OvertureRecord[];
try {
  const parsed = JSON.parse(run.stdout || "[]");
  rows = Array.isArray(parsed) ? parsed : [];
} catch (e) {
  die(`Could not parse DuckDB output as JSON: ${(e as Error).message}`);
}

// DuckDB returns geometry as a GeoJSON STRING (ST_AsGeoJSON), so re-hydrate it
// into the object shape coordsOf reads.
for (const r of rows) {
  const gj = (r as Record<string, unknown>).geometry_json;
  if (typeof gj === "string") {
    try {
      (r as Record<string, unknown>).geometry = JSON.parse(gj);
    } catch {
      /* leave it; normalizeOvertureRecord will reject for no_coordinates */
    }
  }
}

console.log(`Rows returned    : ${rows.length}`);

const { seeds, accepted, rejected } = normalizeBatch(rows);

console.log(`Accepted         : ${accepted}`);
const rejectedTotal = Object.values(rejected).reduce((a, b) => a + b, 0);
if (rejectedTotal) {
  console.log(`Rejected         : ${rejectedTotal}`);
  for (const [reason, n] of Object.entries(rejected)) {
    if (n > 0) console.log(`  ${reason.padEnd(26)} ${n}`);
  }
}

if (!accepted) die("No usable lodging records. Check --country / --bbox and the --release pin.");

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, seeds.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
console.log(`\nWrote ${accepted} seed(s) -> ${OUTPUT}`);

if (PIPE) {
  // Always a DRY RUN from here. Writing to a database is a decision that needs
  // the target named explicitly (ingest-hotel-seeds.mts refuses without
  // --project, and refuses again if the ref does not match SUPABASE_URL), and
  // a --pipe convenience flag must not be the thing that bypasses it.
  console.log(`\n--pipe: running ingest in DRY RUN.\n`);
  const ingest = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/ingest-hotel-seeds.mts", "--input", OUTPUT, "--dry-run"],
    { encoding: "utf8", stdio: "inherit" }
  );
  if (ingest.status !== 0) die("Ingest dry run failed.");
  console.log(
    `\nTo write for real:\n` +
      `  node --experimental-strip-types scripts/ingest-hotel-seeds.mts --input ${OUTPUT} --project <ref>\n`
  );
}

console.log();
