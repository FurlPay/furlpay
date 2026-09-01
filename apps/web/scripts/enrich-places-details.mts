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
// ── WHY CONCURRENCY AND NOT A SMALLER DELAY ────────────────────────────────
// Measured on the first 500 records: a round trip to Google takes about 840ms,
// so at --delay 250 the loop ran at 0.92/sec and the delay accounted for under
// a quarter of that. Dropping the delay to zero would have bought ~20%. The
// process is waiting on the network, not on a rate limit, so the lever is
// having several requests in flight — six workers move the same 16,000 records
// in about a tenth of the time, and cost is per request either way.
//
// FLAGS
//   --limit <n>      Stop after n properties. Use it first.
//   --only <text>    Only properties whose name, city or country contains this
//   --delay <ms>     Between calls, per worker. Default 5000
//   --concurrency <n> Requests in flight at once. Default 1
//   --missing <field> Only properties lacking that field, checkpoint ignored.
//                    For topping up after the field mask grows.
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
  /** Which layer the stored coordinate came from. */
  coordinateSource?: string;
  /** Set only when Details disagreed with the stored position by more than
   *  COORD_DRIFT_M, so those can be reviewed as a set afterwards. */
  coordinateMovedM?: number;
  address?: string;
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
const CONCURRENCY = Math.max(1, Number(value("concurrency") ?? 1));
/** Let the run tune its own concurrency instead of trusting a guess. */
const ADAPTIVE = flag("adaptive");
const DRY_RUN = flag("dry-run");
const COMMIT_ONLY = flag("commit-only");
const ATMOSPHERE = flag("atmosphere");
const RATED_ONLY = flag("rated");
/**
 * Re-fetch only properties missing a given field, ignoring the checkpoint.
 *
 * For topping up after the mask grows. When `coordinateSource` was added the
 * 11,000 records already fetched had no way to acquire it — they were fetched
 * correctly, under an older mask, and the checkpoint rightly says so. This is
 * the one case where skipping "already done" is wrong, so --missing overrides
 * it. Deliberately narrow: it names the field, so the re-spend is bounded and
 * visible rather than a blanket re-run.
 */
const MISSING = value("missing");
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
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
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

/** Metres between two coordinates. Enough for a "did this move?" check. */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A coordinate that has moved further than this is worth knowing about: it is
 *  usually the search having matched a city centre where Details knows the
 *  building. Well beyond GPS-grade jitter, well inside "different place". */
const COORD_DRIFT_M = 100;

/**
 * Map a Details response onto the fields the dataset actually stores.
 * Absent stays absent — a missing rating must not become a zero.
 *
 * The coordinate is the reason this takes `existing`. Place Details returns
 * the property's own position, where the original loader stored whatever the
 * SEARCH matched — and a search can land on a city centre. So Details wins,
 * the source is recorded, and a move beyond COORD_DRIFT_M is flagged rather
 * than applied silently: a pin that jumps 4km should be reviewable, not just
 * different.
 */
function toPatch(d: PlaceDetails, existing?: StoredProperty): Partial<StoredProperty> {
  const patch: Partial<StoredProperty> = { enrichedAt: new Date().toISOString() };

  const lat = d.location?.latitude;
  const lng = d.location?.longitude;
  if (typeof lat === "number" && typeof lng === "number") {
    patch.latitude = lat;
    patch.longitude = lng;
    patch.coordinateSource = "place_details";
    if (existing && typeof existing.latitude === "number") {
      const moved = metresBetween(existing.latitude, existing.longitude, lat, lng);
      if (moved > COORD_DRIFT_M) patch.coordinateMovedM = Math.round(moved);
    }
  }
  if (d.formattedAddress) patch.address = d.formattedAddress;

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

/** 429 and 5xx say "later", not "never" — the place is fine and the request
 *  was fine, we simply asked too fast. They are retried here and, if they
 *  still fail, deliberately NOT written to the checkpoint, so a resumed run
 *  tries them again. Anything else (404, a malformed id) is permanent and is
 *  recorded so we do not pay to be told twice. */
function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

async function fetchDetails(placeId: string, key: string, attempt = 0) {
  let res: Response;
  try {
    res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": MASK },
    });
  } catch {
    // A THROWN failure, not an HTTP one: a reset socket, a DNS blip, a dropped
    // connection. fetch() rejects rather than returning a status, so without
    // this the rejection escapes the worker, escapes Promise.all, and kills
    // every other worker with it — which is exactly how a run at 23/sec died
    // at 71% with nothing committed. Network errors are transient by nature,
    // so they retry on the same ladder as a 429 and are never checkpointed.
    if (attempt < MAX_RETRIES) {
      await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250);
      return fetchDetails(placeId, key, attempt + 1);
    }
    return { ok: false as const, status: 0, transient: true };
  }
  if (res.ok) return { ok: true as const, status: 200, details: (await res.json()) as PlaceDetails };

  if (isTransient(res.status) && attempt < MAX_RETRIES) {
    // Exponential, and jittered so six workers throttled at the same instant
    // do not all come back at the same instant and throttle each other again.
    const wait = BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250;
    await sleep(wait);
    return fetchDetails(placeId, key, attempt + 1);
  }
  return { ok: false as const, status: res.status, transient: isTransient(res.status) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1000;

// ── ADAPTIVE PACING ────────────────────────────────────────────────────────
// A fixed delay is the wrong instrument. Too large and it idles — measured at
// --delay 250, three quarters of each cycle was network wait, not delay. Too
// small and it trips Google's quota: six workers with no pacing produced 402
// rate-limit failures in one minute. And the right number is not knowable in
// advance, because it moves with the network, the time of day and the quota
// on the key.
//
// So the run finds it. Concurrency climbs by one every RAMP_AFTER consecutive
// successes and halves on a 429, which settles just under whatever the real
// ceiling happens to be and re-finds it if that ceiling moves. This is TCP
// congestion control's additive-increase / multiplicative-decrease, for the
// same reason: probe gently upward, retreat hard on the first sign of loss.
const RAMP_AFTER = 40;
const MAX_WORKERS = 12;

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
    if (MISSING) {
      // Selecting BY the gap, so the checkpoint must not veto it.
      const v = p[MISSING];
      if (v !== undefined && v !== null && v !== "") return false;
    } else if (done.has(p.placeId)) {
      return false;
    }
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
  console.log(`delay ${DELAY_MS}ms - concurrency ${CONCURRENCY} -> about ${(Number(hours) / CONCURRENCY).toFixed(1)}h
`);

  if (DRY_RUN) {
    for (const p of work.slice(0, 10)) console.log(`  would fetch  ${p.name} — ${p.city ?? "?"}`);
    if (work.length > 10) console.log(`  … and ${work.length - 10} more`);
    return;
  }
  if (!work.length) return;

  const key = apiKey();
  let ok = 0;
  let failed = 0;

  let cursor = 0;
  let active = 0;
  // Set by any worker that sees a key-shaped failure; every worker checks it
  // before taking more work, so the run winds down instead of hammering on.
  let abort = false;
  const started = Date.now();

  // Adaptive state. `limit` is how many workers may be in flight right now.
  let limit = ADAPTIVE ? Math.min(CONCURRENCY, MAX_WORKERS) : CONCURRENCY;
  let sinceThrottle = 0;
  let throttles = 0;

  function onSuccess() {
    if (!ADAPTIVE) return;
    if (++sinceThrottle >= RAMP_AFTER && limit < MAX_WORKERS) {
      limit++;
      sinceThrottle = 0;
      console.log(`  ~ clean for ${RAMP_AFTER}, raising concurrency to ${limit}`);
    }
  }

  function onThrottle() {
    if (!ADAPTIVE) return;
    throttles++;
    sinceThrottle = 0;
    const next = Math.max(1, Math.floor(limit / 2));
    if (next < limit) {
      limit = next;
      console.log(`  ~ throttled, halving concurrency to ${limit}`);
    }
  }

  /** One worker: take the next index, fetch it, record it, repeat.
   *  A shared cursor rather than pre-sliced ranges keeps every worker busy
   *  even when some requests are far slower than others. */
  async function worker(): Promise<void> {
    for (;;) {
      if (abort) return;
      // Park while the pool is shrunk below this worker's slot.
      while (ADAPTIVE && active >= limit && !abort) await sleep(50);
      if (abort) return;
      const i = cursor++;
      if (i >= work.length) return;
      const p = work[i];

      active++;
      const r = await fetchDetails(p.placeId, key);
      active--;
      const done = ok + failed + 1;

      if (r.ok) {
        const patch = toPatch(r.details, p);
        // appendFileSync from Node's single thread: two workers cannot
        // interleave a line, so the sidecar stays parseable.
        appendCheckpoint({ placeId: p.placeId, ok: true, at: new Date().toISOString(), patch });
        ok++;
        onSuccess();
        const bits = [
          patch.rating ? `${patch.rating} stars` : null,
          patch.photoCount ? `${patch.photoCount} photos` : null,
          patch.website ? "site" : null,
        ].filter(Boolean);
        console.log(`  [${done}/${work.length}] ${p.name} - ${bits.join(", ") || "no extra data"}`);
      } else {
        // Only a PERMANENT failure is recorded. Writing a 429 here would mark
        // the property attempted and a resumed run would skip it forever —
        // which is exactly how a rate-limited batch silently loses records.
        if (r.status === 429) onThrottle();
        if (!r.transient) {
          appendCheckpoint({ placeId: p.placeId, ok: false, at: new Date().toISOString(), status: r.status });
        }
        failed++;
        console.log(
          `  [${done}/${work.length}] ${p.name} - HTTP ${r.status}` +
            (r.transient ? " (transient, will retry on resume)" : "")
        );
        // A dead key fails every call. Stopping costs a few in-flight
        // requests; not stopping walks the whole dataset logging the same
        // error thousands of times, and writes a checkpoint that makes every
        // one of them look attempted.
        if (r.status === 400 || r.status === 403) {
          abort = true;
          console.error(`stopping: HTTP ${r.status} usually means the key is invalid or restricted`);
          return;
        }
      }

      // Per worker, so N workers settle at roughly N requests per DELAY_MS.
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  }

  // Workers beyond the current limit park here rather than exiting, so the
  // pool can grow again without respawning.
  // allSettled, not all: one worker throwing must not abandon the other
  // fifteen mid-flight and skip the commit. Anything that still escapes a
  // worker is reported after the results are safely merged.
  const outcomes = await Promise.allSettled(
    Array.from({ length: ADAPTIVE ? MAX_WORKERS : CONCURRENCY }, worker)
  );
  for (const o of outcomes) {
    if (o.status === "rejected") console.error(`  ! worker died: ${String(o.reason).slice(0, 200)}`);
  }

  const mins = (Date.now() - started) / 60_000;
  console.log(
    `fetched ${ok}, failed ${failed}, throttled ${throttles} in ${mins.toFixed(1)} min ` +
      `(${((ok + failed) / (mins * 60)).toFixed(2)}/sec)`
  );
  commitCheckpoint();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
