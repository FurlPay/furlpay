#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Load a discovery run into `places_accommodation` (migration 0013).
//
// Reads the checkpoint written by the ingestion script, normalizes each place
// through lib/hotels/placesStore (the same code the read path uses, so the two
// cannot disagree about what a property IS), and upserts by place_id.
//
// IDEMPOTENT BY CONSTRUCTION. The upsert key is the Google place ID, which is
// also the table's primary key, so running this twice is a no-op rather than a
// duplicate. That matters more than it sounds: a discovery run finds the same
// hotel in four overlapping grid cells, and a loader that inserted rather than
// upserted would turn one property into four markers on the same building.
//
// WHICH DATABASE — THE GUARD IS THE POINT.
// `.env.local` in this repo points at PRODUCTION. A loader that defaults to
// "whatever is in the environment" would therefore write to the production
// database the first time someone ran it without thinking, which is exactly the
// accident worth engineering against. So the target project ref must be passed
// explicitly on the command line AND must match the URL's own subdomain; a
// mismatch aborts before a single row is written.
//
//   node --experimental-strip-types scripts/load-places-accommodation.mts \
//     --state <path-to-state.json> \
//     --project tvdyfwceiecxwgqhcsge \
//     [--dry-run] [--batch 200]
//
// The URL and key come from SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the
// environment, so no credential is ever written to a file or into argv.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { toRow, type AccommodationRow, type DiscoveredPlace } from "../src/lib/hotels/placesStore.ts";

const args = process.argv.slice(2);
const flag = (name: string, dflt?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};

const STATE_PATH = flag("state");
const PROJECT = flag("project");
const DRY_RUN = args.includes("--dry-run");
const BATCH = Number(flag("batch", "200"));

const URL_ = process.env.SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function die(msg: string): never {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

if (!STATE_PATH) die("--state <path> is required (the ingestion checkpoint).");
if (!PROJECT) die("--project <ref> is required. Naming the target is not optional — see the header.");
if (!URL_ || !KEY) die("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.");

// The guard. `.env.local` points at production, so an operator who sources the
// wrong env file must be stopped by the tool rather than by their own memory.
const urlRef = URL_.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
if (!urlRef) die(`SUPABASE_URL does not look like a Supabase project URL: ${URL_}`);
if (urlRef !== PROJECT) {
  die(
    `REFUSING TO WRITE.\n` +
    `  --project says   ${PROJECT}\n` +
    `  SUPABASE_URL is  ${urlRef}\n` +
    `  These must match. Check which env file is sourced before retrying.`
  );
}

// --- read and normalize ------------------------------------------------------
const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as {
  label?: string;
  properties: Record<string, DiscoveredPlace>;
};

const places = Object.values(state.properties ?? {});
if (!places.length) die(`No properties in ${STATE_PATH}.`);

const rows: AccommodationRow[] = [];
const rejected: DiscoveredPlace[] = [];
for (const p of places) {
  const row = toRow(p);
  if (row) rows.push(row);
  // A rejected place is reported, never silently dropped — each one is a
  // property that would have become a marker standing on bad data.
  else rejected.push(p);
}

console.log(`\nLoading ${state.label ?? "discovery run"} -> ${PROJECT}`);
console.log(`  places in checkpoint  ${places.length}`);
console.log(`  normalized to rows    ${rows.length}`);
console.log(`  rejected              ${rejected.length}`);
if (rejected.length) {
  for (const r of rejected.slice(0, 5)) {
    console.log(`    - ${r.name || "(no name)"} [${r.googlePlaceId || "no id"}]`);
  }
}

const byType: Record<string, number> = {};
for (const r of rows) byType[r.property_type] = (byType[r.property_type] ?? 0) + 1;
console.log(`  by type               ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`);

if (DRY_RUN) {
  console.log(`\n  --dry-run: nothing written.\n`);
  process.exit(0);
}

// --- upsert ------------------------------------------------------------------
// `resolution=merge-duplicates` makes this an upsert on the primary key, which
// is what makes a re-run cheap instead of a constraint violation.
async function upsert(batch: AccommodationRow[], attempt = 0): Promise<void> {
  const res = await fetch(`${URL_}/rest/v1/places_accommodation`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(batch),
  });

  if (res.ok) return;

  const body = await res.text().catch(() => "");

  // A missing table is an operator error, not a transient one — say so plainly
  // rather than retrying five times and then reporting a timeout.
  if (res.status === 404 || body.includes("PGRST205")) {
    die(
      `Table places_accommodation does not exist on ${PROJECT}.\n` +
      `  Apply supabase/migrations/0013_places_accommodation.sql first.`
    );
  }

  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const wait = 2 ** attempt * 500 + Math.random() * 250;
    console.log(`    backing off ${Math.round(wait)}ms (HTTP ${res.status})`);
    await new Promise((r) => setTimeout(r, wait));
    return upsert(batch, attempt + 1);
  }

  die(`Upsert failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
}

let written = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  await upsert(batch);
  written += batch.length;
  console.log(`  written ${written}/${rows.length}`);
}

// --- verify ------------------------------------------------------------------
// Read back rather than trusting the writes. A loader that reports success
// without checking is how a half-loaded table gets mistaken for a full one.
const check = await fetch(
  `${URL_}/rest/v1/places_accommodation?select=place_id&limit=1`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" } }
);
const range = check.headers.get("content-range") ?? "";
const total = range.split("/")[1] ?? "unknown";

console.log(`\n  upserted   ${written}`);
console.log(`  table now holds ${total} rows`);
console.log(`  re-running is a no-op: place_id is the primary key.\n`);
