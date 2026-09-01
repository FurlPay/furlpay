// ---------------------------------------------------------------------------
// Enrich google-places.json with Place Details.
//
//   npx tsx apps/web/scripts/enrich-places-details.mts --limit 50
//   npx tsx apps/web/scripts/enrich-places-details.mts --only Dubai
//   npx tsx apps/web/scripts/enrich-places-details.mts --commit-only
//
// The dataset holds 16,014 properties that are complete on identity and
// position and almost empty on everything else: 7% have a rating, 4% a photo
// count, 2% a summary. Those were never fetched, so the map draws pins it knows
// nothing about. This fills them in.
//
// ── WHAT IS AND IS NOT STORED ──────────────────────────────────────────────
// The Places policy exempts the place ID from its caching restriction and
// nothing else, and photo NAMES additionally expire. So this script stores the
// durable, re-fetchable facts — rating, review count, website, summary, type,
// business status — under the dataset's existing 30-day expiry, and stores
// `photoCount` but never a photo name or URI.
//
// That is not a limitation on showing pictures. api/travel/hotels/preview
// already resolves photo names live and hands back a photoProxyUrl, marked
// private/no-store. The map gets its images from there. What this script adds
// is knowing, before the call, WHICH properties have images worth fetching —
// today the map cannot tell a property with ten photographs from one with none.
//
// ── RESUMABILITY, AND WHY THE CHECKPOINT IS A SIDECAR ───────────────────────
// openDataset's commit() releases the lock, by design: it is a single
// transaction, not a session. A run over thousands of places at a polite delay
// takes hours and cannot hold that lock, and must survive being interrupted.
// So results stream to a JSONL sidecar as they arrive, and the dataset is
// opened and merged exactly once, at the end. Re-running skips whatever the
// sidecar already holds, so an interrupted run resumes instead of re-billing.
//
// ── COST ───────────────────────────────────────────────────────────────────
// The field mask sits in the Enterprise SKU because of rating, userRatingCount,
// priceLevel and websiteUri. Everything else in the mask is Essentials or Pro
// and therefore free inside that tier — billing is by the highest tier touched,
// so adding cheap fields to an Enterprise call costs nothing. The Atmosphere
// fields (reviews, the serves* set, accessibility) are deliberately NOT in the
// default mask: they would raise every call to the highest tier for data no
// current surface reads. --atmosphere opts in per run.
//
// FLAGS
//   --limit <n>      Stop after n properties. Use it first.
//   --only <text>    Only properties whose name, city or country contains this
//   --delay <ms>     Between calls. Default 5000
//   --rated          Only properties that already have a rating
//   --unrated        Only properties that do not
//   --atmosphere     Add reviews + the food/accessibility fields (costs more)
//   --commit-only    Merge an existing checkpoint and exit, making no calls
//   --dry-run        Report the plan, make no calls and write nothing
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDataset } from "./lib/dataset.mts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const DATASET = path.join(WEB_ROOT, "src/data/google-places.json");
const CHECKPOINT = path.join(WEB_ROOT, "src/data/.places-enrich.jsonl");

// --- the record shapes we touch ---------------------------------------------

interface StoredProperty {
  placeId: string;
  name: string;
  city?: string | null;
  country?: string | null;
  latitude: number;
  longitude: number;
  rating?: number;
  ratingCount?: number;
  photoCount?: number;
  website?: string;
  summary?: string;
  priceLevel?: string;
  businessStatus?: string;
  typeDisplay?: string;
  propertyType?: string;
  enrichedAt?: string;
  [k: string]: unknown;
}

interface Dataset {
  generatedAt: string;
  expiresAt: string;
  source: string;
  attribution: string;
  count: number;
  properties: StoredProperty[];
}

/** One line of the sidecar. `ok:false` records a place that will never work,
 *  so a resumed run does not pay to be told the same thing twice. */
interface CheckpointLine {
  placeId: string;
  ok: boolean;
  at: string;
  status?: number;
  patch?: Partial<StoredProperty>;
}

// --- CLI ---------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const LIMIT = Number(value("limit") ?? Infinity);
const ONLY = (value("only") ?? "").toLowerCase();
const DELAY_MS = Number(value("delay") ?? 5000);
const DRY_RUN = flag("dry-run");
const COMMIT_ONLY = flag("commit-only");
const ATMOSPHERE = flag("atmosphere");
const RATED_ONLY = flag("rated");
const UNRATED_ONLY = flag("unrated");

// --- field mask --------------------------------------------------------------

/** Enterprise tier, driven by rating/userRatingCount/priceLevel/websiteUri.
 *  The rest ride along inside that tier at no extra cost. */
const CORE_FIELDS = [
  "id",
  "rating",
  "userRatingCount",
  "priceLevel",
  "websiteUri",
  "businessStatus",
  "primaryType",
  "primaryTypeDisplayName",
  "types",
  "editorialSummary",
  "photos",
  "location",
  "formattedAddress",
];

/** Opt-in. Raises the call to the highest tier, so it is off by default. */
const ATMOSPHERE_FIELDS = [
  "reviews",
  "accessibilityOptions",
  "parkingOptions",
  "allowsDogs",
  "goodForChildren",
  "servesBreakfast",
  "servesLunch",
  "servesDinner",
  "servesVegetarianFood",
  "dineIn",
  "takeout",
  "delivery",
  "reservable",
  "outdoorSeating",
  "regularOpeningHours",
];

const MASK = (ATMOSPHERE ? [...CORE_FIELDS, ...ATMOSPHERE_FIELDS] : CORE_FIELDS).join(",");

// --- key ---------------------------------------------------------------------

function apiKey(): string {
  const fromEnv = process.env.GOOGLE_PLACES_API_KEY;
  if (fromEnv) return fromEnv;
  // Convenience for local runs. The value is never logged.
  const envFile = path.join(WEB_ROOT, ".env.local");
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, "utf8").match(/^GOOGLE_PLACES_API_KEY=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("GOOGLE_PLACES_API_KEY is not set (env or apps/web/.env.local)");
}

// --- checkpoint --------------------------------------------------------------

function readCheckpoint(): Map<string, CheckpointLine> {
  const seen = new Map<string, CheckpointLine>();
  if (!fs.existsSync(CHECKPOINT)) return seen;
  for (const line of fs.readFileSync(CHECKPOINT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as CheckpointLine;
      // Later lines win: a re-run of a previously failed place replaces it.
      seen.set(rec.placeId, rec);
    } catch {
      // A half-written final line is the normal shape of an interrupted run.
      // Skipping it costs one re-fetch; refusing to start costs the whole run.
    }
  }
  return seen;
}

function appendCheckpoint(rec: CheckpointLine): void {
  fs.appendFileSync(CHECKPOINT, JSON.stringify(rec) + "\n");
}

// --- fetch -------------------------------------------------------------------

interface PlaceDetails {
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  websiteUri?: string;
  businessStatus?: string;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  editorialSummary?: { text?: string };
  photos?: unknown[];
  types?: string[];
}

/** Map a Details response onto the fields the dataset actually stores.
 *  Absent stays absent — a missing rating must not become a zero. */
function toPatch(d: PlaceDetails): Partial<StoredProperty> {
  const patch: Partial<StoredProperty> = { enrichedAt: new Date().toISOString() };
  if (typeof d.rating === "number") patch.rating = d.rating;
  if (typeof d.userRatingCount === "number") patch.ratingCount = d.userRatingCount;
  if (d.priceLevel) patch.priceLevel = d.priceLevel;
  if (d.websiteUri) patch.website = d.websiteUri;
  if (d.businessStatus) patch.businessStatus = d.businessStatus;
  if (d.primaryTypeDisplayName?.text) patch.typeDisplay = d.primaryTypeDisplayName.text;
  if (d.editorialSummary?.text) patch.summary = d.editorialSummary.text;
  // COUNT ONLY. Photo names expire and the policy does not permit keeping them;
  // the count is what lets a surface decide whether a live fetch is worthwhile.
  if (Array.isArray(d.photos)) patch.photoCount = d.photos.length;
  return patch;
}

async function fetchDetails(placeId: string, key: string) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": MASK },
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  return { ok: true as const, status: 200, details: (await res.json()) as PlaceDetails };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- merge -------------------------------------------------------------------

/** Fold the sidecar into the dataset under the lock, once. */
function commitCheckpoint(): void {
  const done = readCheckpoint();
  const patches = [...done.values()].filter((r) => r.ok && r.patch);
  if (!patches.length) {
    console.log("nothing to commit — checkpoint holds no successful records");
    return;
  }

  const held = openDataset<Dataset>(DATASET, "enrich-places-details");
  try {
    const byId = new Map(held.data.properties.map((p) => [p.placeId, p]));
    let applied = 0;
    for (const rec of patches) {
      const target = byId.get(rec.placeId);
      if (!target) continue;
      Object.assign(target, rec.patch);
      applied++;
    }
    // count is a header field; the property list length is the truth.
    held.data.count = held.data.properties.length;
    held.commit(held.data);
    console.log(`committed ${applied} enriched properties into ${path.basename(DATASET)}`);
  } catch (e) {
    held.release();
    throw e;
  }
}

// --- main --------------------------------------------------------------------

async function main() {
  if (COMMIT_ONLY) {
    commitCheckpoint();
    return;
  }

  const dataset = JSON.parse(fs.readFileSync(DATASET, "utf8")) as Dataset;
  const done = readCheckpoint();

  let work = dataset.properties.filter((p) => {
    if (done.has(p.placeId)) return false;
    if (RATED_ONLY && typeof p.rating !== "number") return false;
    if (UNRATED_ONLY && typeof p.rating === "number") return false;
    if (ONLY) {
      const hay = `${p.name} ${p.city ?? ""} ${p.country ?? ""}`.toLowerCase();
      if (!hay.includes(ONLY)) return false;
    }
    return true;
  });
  if (Number.isFinite(LIMIT)) work = work.slice(0, LIMIT);

  const hours = ((work.length * DELAY_MS) / 3_600_000).toFixed(1);
  console.log(
    `dataset ${dataset.properties.length} · already done ${done.size} · to fetch ${work.length}`
  );
  console.log(`mask: ${ATMOSPHERE ? "Enterprise + Atmosphere" : "Enterprise"} (${MASK.split(",").length} fields)`);
  console.log(`delay ${DELAY_MS}ms → about ${hours}h\n`);

  if (DRY_RUN) {
    for (const p of work.slice(0, 10)) console.log(`  would fetch  ${p.name} — ${p.city ?? "?"}`);
    if (work.length > 10) console.log(`  … and ${work.length - 10} more`);
    return;
  }
  if (!work.length) return;

  const key = apiKey();
  let ok = 0;
  let failed = 0;

  for (const [i, p] of work.entries()) {
    const r = await fetchDetails(p.placeId, key);
    if (r.ok) {
      const patch = toPatch(r.details);
      appendCheckpoint({ placeId: p.placeId, ok: true, at: new Date().toISOString(), patch });
      ok++;
      const bits = [
        patch.rating ? `${patch.rating}★` : null,
        patch.photoCount ? `${patch.photoCount} photos` : null,
        patch.website ? "site" : null,
      ].filter(Boolean);
      console.log(`  [${i + 1}/${work.length}] ${p.name} — ${bits.join(", ") || "no extra data"}`);
    } else {
      appendCheckpoint({ placeId: p.placeId, ok: false, at: new Date().toISOString(), status: r.status });
      failed++;
      console.log(`  [${i + 1}/${work.length}] ${p.name} — HTTP ${r.status}`);
      // A dead key fails every call. Stopping costs one wasted request; not
      // stopping walks the whole dataset logging the same error thousands of
      // times, and writes a checkpoint that makes each one look attempted.
      if (r.status === 400 || r.status === 403) {
        console.error(`\nstopping: HTTP ${r.status} usually means the key is invalid or restricted`);
        break;
      }
    }
    if (i < work.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nfetched ${ok}, failed ${failed}`);
  commitCheckpoint();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
