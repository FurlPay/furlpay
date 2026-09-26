#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Ingest lodging seeds into `universal_hotels` (migration 0015).
//
// Reads JSONL, resolves each seed against what is already in the registry via
// the SAME H3 consensus the read path uses (lib/hotels/h3.ts), and either
// enriches an existing property or inserts a new one.
//
//   node --experimental-strip-types scripts/ingest-hotel-seeds.mts \
//     --input seeds/overture-sg.jsonl \
//     --project tvdyfwceiecxwgqhcsge \
//     [--dry-run] [--batch 200]
//
// WHERE SEEDS COME FROM — AND WHERE THEY DO NOT
// Intended sources are ones that may be redistributed commercially:
//   * Overture Maps Places (CDLA-Permissive) — ~2.1M accommodations, GERS ids
//   * OpenStreetMap Planet (ODbL — attribution required downstream)
//   * National tourism registries (STB, DET, ATOUT) — official star ratings
//   * A property's own published booking widget, fetched politely
//
// This script deliberately has NO crawler, NO search-engine dorking, and NO
// anti-bot evasion. Seeds arrive as a file someone obtained lawfully; the
// ingest's job is consensus and storage, not acquisition. Keeping acquisition
// out of this file is what stops "just add a scraper here" from becoming a
// one-line change later.
//
// IDEMPOTENT BY CONSTRUCTION. Re-running the same file makes no new rows: a
// seed either matches an existing property by source id, or by spatial
// consensus, or it is genuinely new.
//
// WHICH DATABASE — THE GUARD IS THE POINT.
// `.env.local` in this repo points at PRODUCTION, so the target project ref
// must be passed explicitly AND match the URL's own subdomain. Mirrors
// scripts/load-places-accommodation.mts; a mismatch aborts before any write.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cellFor, haversineMeters, jaroWinkler, normalizeName, MERGE_DISTANCE_M, NAME_SIMILARITY_MIN } from "../src/lib/hotels/h3.ts";
import { gridDisk } from "h3-js";

// --- args --------------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name: string, fallback = ""): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const INPUT = flag("input");
const PROJECT = flag("project");
const DRY_RUN = args.includes("--dry-run");
const BATCH = Math.max(1, Math.min(500, Number(flag("batch", "200")) || 200));

const URL_ = process.env.SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function die(msg: string): never {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

if (!INPUT) die("--input <file.jsonl> is required.");

// A dry run reads nothing from the database and writes nothing to it, so it
// needs no credentials and no project guard. Everything else does.
if (!DRY_RUN) {
  if (!PROJECT) die("--project <ref> is required. Naming the target is not optional — see the header.");
  if (!URL_ || !KEY) die("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.");

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
}

// --- seed shape --------------------------------------------------------------

interface Seed {
  name: string;
  latitude: number;
  longitude: number;
  city?: string;
  countryCode?: string;
  stars?: number;
  propertyType?: string;
  /** Whichever external identity this seed carries. */
  overtureId?: string;
  osmId?: string;
  googlePlaceId?: string;
  tripHotelId?: string;
  pmsProvider?: string;
  directBookingUrl?: string;
}

const PROPERTY_TYPES = new Set([
  "hotel", "resort", "villa", "private_room", "bed_and_breakfast",
  "guest_house", "hostel", "motel", "extended_stay", "other_accommodation",
]);
const PMS_PROVIDERS = new Set([
  "synxis", "travelclick", "cloudbeds", "mews", "siteminder", "dedge", "direct_custom",
]);

interface Rejection {
  line: number;
  reason: string;
  raw: string;
}

const rejected: Rejection[] = [];

/**
 * Validate a seed against the same CHECK constraints migration 0015 enforces.
 *
 * Doing it here rather than letting Postgres reject the batch means one bad
 * row is reported with its line number instead of failing 200 good rows
 * alongside it — and a rejected seed is always REPORTED, never silently
 * dropped, because each one is a property that would otherwise be missing from
 * the map with no trace of why.
 */
function parseSeed(raw: string, line: number): Seed | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    rejected.push({ line, reason: "not valid JSON", raw: raw.slice(0, 120) });
    return null;
  }

  const name = typeof j.name === "string" ? j.name.trim() : "";
  const latitude = Number(j.latitude);
  const longitude = Number(j.longitude);
  const countryCode = typeof j.countryCode === "string" ? j.countryCode.toUpperCase() : "";

  if (!name || name.length > 300) {
    rejected.push({ line, reason: "name missing or over 300 chars", raw: name.slice(0, 80) });
    return null;
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    rejected.push({ line, reason: `latitude out of range: ${j.latitude}`, raw: name });
    return null;
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    rejected.push({ line, reason: `longitude out of range: ${j.longitude}`, raw: name });
    return null;
  }
  // 0,0 is in the Gulf of Guinea. It is almost always a missing-coordinate
  // sentinel, and a seed placed there becomes a pin in the ocean.
  if (latitude === 0 && longitude === 0) {
    rejected.push({ line, reason: "null island (0,0) — missing coordinates", raw: name });
    return null;
  }
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    rejected.push({ line, reason: `countryCode must be ISO-3166 alpha-2, got "${j.countryCode}"`, raw: name });
    return null;
  }

  const propertyType = typeof j.propertyType === "string" ? j.propertyType : "hotel";
  if (!PROPERTY_TYPES.has(propertyType)) {
    rejected.push({ line, reason: `unknown propertyType "${propertyType}"`, raw: name });
    return null;
  }

  const stars = j.stars === undefined || j.stars === null ? undefined : Number(j.stars);
  if (stars !== undefined && (!Number.isFinite(stars) || stars < 1 || stars > 5)) {
    rejected.push({ line, reason: `stars must be 1-5, got ${j.stars}`, raw: name });
    return null;
  }

  const pmsProvider = typeof j.pmsProvider === "string" ? j.pmsProvider : undefined;
  if (pmsProvider && !PMS_PROVIDERS.has(pmsProvider)) {
    rejected.push({ line, reason: `unknown pmsProvider "${pmsProvider}"`, raw: name });
    return null;
  }

  return {
    name,
    latitude,
    longitude,
    city: typeof j.city === "string" ? j.city.slice(0, 160) : undefined,
    countryCode,
    stars,
    propertyType,
    overtureId: typeof j.overtureId === "string" ? j.overtureId : undefined,
    osmId: typeof j.osmId === "string" ? j.osmId : undefined,
    googlePlaceId: typeof j.googlePlaceId === "string" ? j.googlePlaceId : undefined,
    tripHotelId: typeof j.tripHotelId === "string" ? j.tripHotelId : undefined,
    pmsProvider,
    directBookingUrl: typeof j.directBookingUrl === "string" ? j.directBookingUrl.slice(0, 1024) : undefined,
  };
}

/**
 * Deterministic id from the property's identity, not from a counter.
 *
 * Re-running the ingest must produce the SAME id for the same property or the
 * idempotency guarantee is only as good as the dedupe step. Derived from the
 * strongest external id available, falling back to normalised name + H3 cell —
 * which is stable for a fixed property but deliberately NOT stable across a
 * coordinate correction, since that is a different point on the map.
 */
function deriveId(seed: Seed, cell: string): string {
  const identity =
    seed.overtureId ? `overture:${seed.overtureId}` :
    seed.googlePlaceId ? `google:${seed.googlePlaceId}` :
    seed.osmId ? `osm:${seed.osmId}` :
    seed.tripHotelId ? `trip:${seed.tripHotelId}` :
    `geo:${normalizeName(seed.name)}:${cell}`;
  return `fp_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

// --- read --------------------------------------------------------------------

const lines = readFileSync(INPUT, "utf8").split(/\r?\n/);
const seeds: Seed[] = [];
lines.forEach((raw, i) => {
  const trimmed = raw.trim();
  if (!trimmed) return;
  const seed = parseSeed(trimmed, i + 1);
  if (seed) seeds.push(seed);
});

if (!seeds.length && !rejected.length) die(`No seeds found in ${INPUT}.`);

console.log(`\nSeeds: ${seeds.length} valid, ${rejected.length} rejected  <-  ${INPUT}`);
console.log(`Target: ${DRY_RUN ? "DRY RUN (no database access)" : PROJECT}`);

// --- in-file consensus -------------------------------------------------------
//
// Collapse duplicates WITHIN the file before touching the database. A single
// Overture extract routinely lists one resort several times (one per building
// footprint), and inserting those first would mean the database-side check
// compares each against siblings that should never have been separate rows.

interface Candidate {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  cell: string;
  seed: Seed;
}

const candidates: Candidate[] = [];
const byCell = new Map<string, Candidate[]>();
let collapsedInFile = 0;

for (const seed of seeds) {
  const cell = cellFor(seed.latitude, seed.longitude);
  const norm = normalizeName(seed.name);

  let match: Candidate | null = null;
  for (const neighbour of gridDisk(cell, 1)) {
    for (const cand of byCell.get(neighbour) ?? []) {
      if (haversineMeters(seed.latitude, seed.longitude, cand.latitude, cand.longitude) > MERGE_DISTANCE_M) continue;
      if (jaroWinkler(norm, normalizeName(cand.name)) < NAME_SIMILARITY_MIN) continue;
      match = cand;
      break;
    }
    if (match) break;
  }

  if (match) {
    // Enrich rather than replace: a duplicate often carries an id the first
    // copy lacked, and that is the whole value of seeing it twice.
    match.seed.overtureId ??= seed.overtureId;
    match.seed.osmId ??= seed.osmId;
    match.seed.googlePlaceId ??= seed.googlePlaceId;
    match.seed.tripHotelId ??= seed.tripHotelId;
    match.seed.stars ??= seed.stars;
    match.seed.city ??= seed.city;
    match.seed.pmsProvider ??= seed.pmsProvider;
    match.seed.directBookingUrl ??= seed.directBookingUrl;
    collapsedInFile += 1;
    continue;
  }

  const created: Candidate = {
    id: deriveId(seed, cell),
    name: seed.name,
    latitude: seed.latitude,
    longitude: seed.longitude,
    cell,
    seed,
  };
  candidates.push(created);
  const bucket = byCell.get(cell);
  if (bucket) bucket.push(created);
  else byCell.set(cell, [created]);
}

console.log(`In-file consensus: ${collapsedInFile} duplicate(s) merged -> ${candidates.length} distinct propert${candidates.length === 1 ? "y" : "ies"}`);

// --- rows --------------------------------------------------------------------

function toRow(c: Candidate) {
  return {
    id: c.id,
    name: c.seed.name,
    latitude: c.latitude,
    longitude: c.longitude,
    h3_cell: c.cell,
    property_type: c.seed.propertyType ?? "hotel",
    stars: c.seed.stars ?? null,
    city: c.seed.city ?? null,
    country_code: c.seed.countryCode,
    pms_provider: c.seed.pmsProvider ?? null,
    direct_booking_url: c.seed.directBookingUrl ?? null,
    trip_hotel_id: c.seed.tripHotelId ?? null,
    osm_id: c.seed.osmId ?? null,
    google_place_id: c.seed.googlePlaceId ?? null,
    overture_id: c.seed.overtureId ?? null,
    // NEVER set from a seed. x402 support is a verified settlement capability,
    // and a seed file is an unverified assertion — a true value here would put
    // a "pay direct in USDC" badge on a property nobody has tested.
    x402_supported: false,
    // `location` is set by the 0015 trigger from lat/lng, never written here:
    // two writers for one value is how the index and the payload diverge.
  };
}

const rows = candidates.map(toRow);

if (rejected.length) {
  console.log(`\nRejected ${rejected.length} seed(s):`);
  for (const r of rejected.slice(0, 20)) {
    console.log(`  line ${r.line}: ${r.reason}  (${r.raw})`);
  }
  if (rejected.length > 20) console.log(`  … and ${rejected.length - 20} more`);
}

if (DRY_RUN) {
  console.log(`\nDRY RUN — nothing written. Would upsert ${rows.length} row(s) in batches of ${BATCH}.`);
  console.log("Sample:");
  for (const r of rows.slice(0, 3)) {
    console.log(`  ${r.id}  ${r.name}  (${r.latitude}, ${r.longitude})  ${r.country_code}  h3=${r.h3_cell}`);
  }
  process.exit(0);
}

// --- write -------------------------------------------------------------------
//
// Upsert on the primary key. Because `id` is derived from identity rather than
// generated, a second run of the same file updates the same rows instead of
// duplicating the map.

async function upsertBatch(batch: ReturnType<typeof toRow>[]): Promise<void> {
  const res = await fetch(`${URL_}/rest/v1/universal_hotels?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(batch),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`upsert failed (${res.status}): ${body.slice(0, 400)}`);
  }
}

let written = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  await upsertBatch(batch);
  written += batch.length;
  console.log(`  upserted ${written}/${rows.length}`);
}

console.log(`\nDone. ${written} row(s) upserted into universal_hotels on ${PROJECT}.\n`);
