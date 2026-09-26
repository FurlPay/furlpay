/**
 * Global lodging discovery — place ids and coordinates only.
 *
 *   node scripts/crawl-places-index.mjs --estimate        # cost, crawl nothing
 *   node scripts/crawl-places-index.mjs --limit 5         # bounded run
 *   node scripts/crawl-places-index.mjs --resume          # continue a run
 *
 * ── WHAT THIS STORES, AND WHY ONLY THAT ────────────────────────────────────
 * Two fields per place: the id and the coordinate.
 *
 * Google Maps Platform Terms (§3.2.3) allow caching place ids, and allow
 * caching latitude/longitude for a limited period. They do not extend that to
 * other Places content — names, ratings, addresses, photos. So this requests a
 * field mask of exactly `places.id,places.location`: not as a cost trim,
 * though it is the cheapest SKU, but because a name we are not permitted to
 * keep cannot be written out by accident if it was never fetched.
 *
 * Display content is resolved live per viewport by /api/places/discover. The
 * index answers "which places exist and where"; Google answers "what are they"
 * at the moment someone looks.
 *
 * Read docs/hotels-map-google-places.md before changing the mask. Verify the
 * current terms rather than trusting this comment — it describes the reasoning,
 * not the contract.
 *
 * ── DISCOVERY ONLY ─────────────────────────────────────────────────────────
 * This is the cheap first stage of a pipeline. Metadata, photos and rates are
 * separate, lazier layers: enriching 100k places during discovery would cost
 * enormously and cache content that may not be cached. See the same doc.
 */

import {
  writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, unlinkSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { orderedDestinations, destinationStats } from "./lib/destinations.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..");

/* ------------------------------ configuration ------------------------------ */

const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const num = (n, d) => { const v = Number(val(n, d)); return Number.isFinite(v) ? v : d; };

const CONFIG = {
  out: resolve(WEB, val("out", "src/data/places-index.json")),
  checkpoint: resolve(WEB, val("checkpoint", ".places-index-checkpoint.json")),
  limit: num("limit", 0),
  delayMs: num("delay", 120),
  timeoutMs: num("timeout", 20_000),
  maxRetries: num("max-retries", 4),
  /** Tile edge in degrees. ~0.06 deg ~ 6.7km of latitude. */
  step: num("step", 0.06),
  /** Hard ceiling on tiles per destination, whatever its radius implies. */
  maxTiles: num("max-tiles", 49),
  maxResults: num("max-results", 20),
  /** Stop before issuing more than this. The bill guard. */
  maxRequests: num("max-requests", 3_000),
  /** Stop once the index reaches this size. */
  maxPlaces: num("max-places", 250_000),
  expiryDays: num("expiry-days", 30),
  resume: has("resume"),
  estimateOnly: has("estimate"),
};

/* --------------------------------- api key -------------------------------- */

function readKey() {
  if (process.env.GOOGLE_PLACES_API_KEY) return process.env.GOOGLE_PLACES_API_KEY.trim();
  for (const p of [join(WEB, ".env.local"), join(WEB, "..", "..", ".env.local")]) {
    if (!existsSync(p)) continue;
    const m = readFileSync(p, "utf8").match(/^GOOGLE_PLACES_API_KEY="?([^"\n\r]*)/m);
    if (m && m[1].trim()) return m[1].trim();
  }
  return "";
}

/* ------------------------------- place types ------------------------------- */

/**
 * Lodging types to search, most productive first.
 *
 * Google's supported set changes, and an unsupported `includedType` is a hard
 * 400 on every request that uses it. Rather than hard-coding a list that may
 * rot, an INVALID_ARGUMENT for a type retires that type for the whole run
 * (see `retiredTypes`) so one bad value costs a handful of requests instead of
 * one per tile.
 */
const PLACE_TYPES = [
  "hotel",
  "resort_hotel",
  "extended_stay_hotel",
  "guest_house",
  "bed_and_breakfast",
];

/* --------------------------------- geometry -------------------------------- */

const KM_PER_DEG_LAT = 110.574;

/**
 * Tiles covering a destination's radius.
 *
 * Longitude degrees shrink towards the poles, so a square in degrees is a tall
 * thin rectangle in Reykjavik and roughly square in Singapore. Scaling by
 * cos(latitude) keeps tiles approximately square on the ground; without it,
 * high-latitude cities get over-tiled east-west and burn requests on overlap.
 */
function tilesFor(dest, step, maxTiles) {
  const latStep = step;
  const cos = Math.max(0.15, Math.cos((dest.lat * Math.PI) / 180));
  const lngStep = step / cos;

  const radiusDegLat = dest.radiusKm / KM_PER_DEG_LAT;
  let rings = Math.max(0, Math.round(radiusDegLat / latStep));

  // Clamp by tile budget: (2r+1)^2 <= maxTiles.
  const maxRings = Math.max(0, Math.floor((Math.sqrt(maxTiles) - 1) / 2));
  rings = Math.min(rings, maxRings);

  const out = [];
  for (let dy = -rings; dy <= rings; dy++) {
    for (let dx = -rings; dx <= rings; dx++) {
      const cLat = dest.lat + dy * latStep;
      const cLng = dest.lng + dx * lngStep;
      out.push({
        south: clampLat(cLat - latStep / 2),
        north: clampLat(cLat + latStep / 2),
        west: wrapLng(cLng - lngStep / 2),
        east: wrapLng(cLng + lngStep / 2),
      });
    }
  }
  // Drop tiles the wrap made degenerate rather than sending a bad rectangle.
  return out.filter((t) => t.north > t.south && t.east !== t.west);
}

const clampLat = (n) => Math.min(90, Math.max(-90, n));
const wrapLng = (n) => { let v = n; while (v > 180) v -= 360; while (v < -180) v += 360; return v; };

/** Reject anything that is not a real point on the earth. */
function validCoord(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0) // null island: a missing coordinate, not a place
  );
}

/* ---------------------------------- http ---------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt) => Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 400);

const METRICS = {
  requests: 0, ok: 0, failed: 0, retries: 0,
  byStatus: {}, network: {}, retiredTypes: new Set(),
};
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

/**
 * One Text Search call.
 *
 * Returns `{ places }` on success, or `{ fatalType: true }` when the type
 * itself is rejected — the caller retires it. Retries 429 and 5xx with
 * exponential backoff plus jitter; never retries a 400 or 403, because a
 * malformed request and a disabled API do not become valid by asking again.
 */
async function searchTile(key, rect, includedType) {
  for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
    METRICS.requests++;
    if (attempt > 0) METRICS.retries++;

    try {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.id,places.location",
        },
        body: JSON.stringify({
          textQuery: includedType.replace(/_/g, " "),
          includedType,
          maxResultCount: CONFIG.maxResults,
          rankPreference: "RELEVANCE",
          locationRestriction: {
            rectangle: {
              low: { latitude: rect.south, longitude: rect.west },
              high: { latitude: rect.north, longitude: rect.east },
            },
          },
        }),
        signal: controller.signal,
      });

      bump(METRICS.byStatus, String(res.status));

      if (res.ok) {
        METRICS.ok++;
        const json = await res.json().catch(() => null);
        if (!json) { METRICS.failed++; return { places: [] }; } // malformed body
        return { places: Array.isArray(json.places) ? json.places : [] };
      }

      const text = await res.text().catch(() => "");

      // Permanent. Asking again wastes a request and a billing unit.
      if (res.status === 400 || res.status === 403 || res.status === 404) {
        METRICS.failed++;

        // A bad key and a bad type BOTH come back 400 INVALID_ARGUMENT, and
        // telling them apart matters: matching on the status alone retired
        // every place type on the first request and produced a clean, empty,
        // entirely wrong index. Credential and quota problems abort the run;
        // only a genuine type rejection retires a type.
        if (/API key not valid|API_KEY_INVALID|api key/i.test(text)) {
          return { places: [], fatalAuth: "The API key was rejected (400 API key not valid)." };
        }
        if (res.status === 403) {
          return {
            places: [],
            fatalAuth:
              /has not been used|is disabled/i.test(text)
                ? "Places API (New) is not enabled on this project."
                : "The API key was refused (403).",
          };
        }

        const invalidType = res.status === 400 && /includedType/i.test(text);
        return { places: [], fatalType: invalidType, permanent: true, detail: text.slice(0, 120) };
      }

      // Retryable: rate limit and server faults.
      if (attempt === CONFIG.maxRetries) { METRICS.failed++; return { places: [], detail: text.slice(0, 120) }; }
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
    } catch (e) {
      const kind = e?.name === "AbortError" ? "timeout" : (e?.cause?.code || e?.name || "network");
      bump(METRICS.network, String(kind));
      if (attempt === CONFIG.maxRetries) { METRICS.failed++; return { places: [] }; }
      await sleep(backoff(attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  METRICS.failed++;
  return { places: [] };
}

/* ------------------------------- checkpoint -------------------------------- */

function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function saveCheckpoint(state) {
  try {
    writeAtomic(CONFIG.checkpoint, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      destIndex: state.destIndex,
      // The index itself, so a resumed run keeps what it already paid for.
      places: [...state.index].map(([id, [la, ln]]) => [id, la, ln]),
      metrics: { requests: METRICS.requests, ok: METRICS.ok, failed: METRICS.failed, retries: METRICS.retries },
    }));
  } catch (e) {
    // A checkpoint is an optimisation. Losing one must not lose the crawl.
    console.warn(`  ! checkpoint write failed (${e?.code ?? e}) — continuing`);
  }
}

function loadCheckpoint() {
  if (!existsSync(CONFIG.checkpoint)) return null;
  try {
    const d = JSON.parse(readFileSync(CONFIG.checkpoint, "utf8"));
    if (d.version !== 1 || !Array.isArray(d.places)) return null;
    return d;
  } catch {
    console.warn("  ! checkpoint unreadable — starting fresh");
    return null;
  }
}

/* ---------------------------------- main ----------------------------------- */

async function main() {
  const started = Date.now();
  const stats = destinationStats();
  const all = orderedDestinations();
  const destinations = CONFIG.limit ? all.slice(0, CONFIG.limit) : all;

  // Plan first, so the cost is known before a single request is issued.
  let plannedTiles = 0;
  for (const d of destinations) plannedTiles += tilesFor(d, CONFIG.step, CONFIG.maxTiles).length;
  const plannedRequests = plannedTiles * PLACE_TYPES.length;

  console.log("Destination set");
  console.log(`  destinations : ${destinations.length} of ${stats.total}  (${stats.countries} countries)`);
  for (const [region, n] of Object.entries(stats.byRegion)) console.log(`     ${region.padEnd(16)} ${n}`);
  console.log("\nPlan");
  console.log(`  tiles        : ${plannedTiles.toLocaleString()}  (step ${CONFIG.step} deg, max ${CONFIG.maxTiles}/destination)`);
  console.log(`  place types  : ${PLACE_TYPES.length}  (${PLACE_TYPES.join(", ")})`);
  console.log(`  requests     : ${plannedRequests.toLocaleString()}  = tiles x types`);
  console.log(`  field mask   : places.id,places.location`);
  console.log(`  request cap  : ${CONFIG.maxRequests.toLocaleString()}`);

  if (plannedRequests > CONFIG.maxRequests) {
    console.log(
      `\nREFUSING: the plan needs ${plannedRequests.toLocaleString()} requests, over the ` +
      `--max-requests cap of ${CONFIG.maxRequests.toLocaleString()}.\n` +
      `Raise the cap deliberately, or reduce scope with --limit / --max-tiles / --step.`
    );
    process.exit(2);
  }

  if (CONFIG.estimateOnly) {
    console.log("\n--estimate: no requests issued.");
    return;
  }

  const key = readKey();
  if (!key) {
    console.error(
      "\nGOOGLE_PLACES_API_KEY is not set.\n" +
      "Put it in apps/web/.env.local (gitignored) or the environment. Nothing was written."
    );
    process.exit(1);
  }

  /** placeId -> [lat, lng] */
  const index = new Map();
  let destIndex = 0;

  if (CONFIG.resume) {
    const cp = loadCheckpoint();
    if (cp) {
      for (const [id, la, ln] of cp.places) index.set(id, [la, ln]);
      destIndex = cp.destIndex ?? 0;
      console.log(`\nresumed: ${index.size.toLocaleString()} places, from destination #${destIndex + 1}`);
    }
  }

  const retired = new Set();
  let stopped = null;

  console.log("");
  for (; destIndex < destinations.length; destIndex++) {
    const dest = destinations[destIndex];
    const before = index.size;
    const tiles = tilesFor(dest, CONFIG.step, CONFIG.maxTiles);

    for (const rect of tiles) {
      for (const type of PLACE_TYPES) {
        if (retired.has(type)) continue;

        if (METRICS.requests >= CONFIG.maxRequests) { stopped = "request cap reached"; break; }
        if (index.size >= CONFIG.maxPlaces) { stopped = "place cap reached"; break; }

        const r = await searchTile(key, rect, type);

        // A credential or enablement problem will not fix itself on the next
        // tile. Stop at once rather than spending the whole budget learning
        // the same thing 29,000 times.
        if (r.fatalAuth) {
          console.error(`\nABORTING: ${r.fatalAuth}`);
          console.error("Nothing was written. Fix the key or enable the API, then re-run.");
          if (existsSync(CONFIG.checkpoint)) console.error("A checkpoint exists — re-run with --resume.");
          process.exit(4);
        }

        if (r.fatalType) {
          retired.add(type);
          METRICS.retiredTypes.add(type);
          console.warn(`  ! type "${type}" rejected by the API — retired for this run`);
          continue;
        }

        for (const p of r.places) {
          const lat = p?.location?.latitude;
          const lng = p?.location?.longitude;
          if (!p?.id || !validCoord(lat, lng)) continue;
          // ~1m precision. Finer is noise and stores more than is needed.
          index.set(p.id, [Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
        }

        if (CONFIG.delayMs) await sleep(CONFIG.delayMs);
      }
      if (stopped) break;
    }

    console.log(
      `  ${String(destIndex + 1).padStart(3)}/${destinations.length} ` +
      `${dest.name.padEnd(18)} +${String(index.size - before).padStart(4)}  total ${index.size.toLocaleString()}`
    );

    saveCheckpoint({ destIndex: destIndex + 1, index });
    if (stopped) break;
  }

  /* ------------------------------ write output ----------------------------- */

  const now = new Date();
  const expires = new Date(now.getTime() + CONFIG.expiryDays * 24 * 60 * 60 * 1000);

  // Sorted by place id: the same inputs produce a byte-identical file, so a
  // diff shows what actually changed rather than Map iteration order.
  const places = [...index]
    .map(([id, [la, ln]]) => [id, la, ln])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  mkdirSync(dirname(CONFIG.out), { recursive: true });
  writeAtomic(
    CONFIG.out,
    JSON.stringify({
      generatedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      source: "Google Places API (New) — Text Search",
      attribution: "Powered by Google",
      fieldMask: "places.id,places.location",
      policy:
        "Place ids and coordinates only. Other Places content (names, ratings, addresses, " +
        "photos) is deliberately not requested or stored; it is resolved live per viewport. " +
        "Consumers must refuse to serve this file past expiresAt.",
      count: places.length,
      places,
    })
  );

  // The crawl finished, so the checkpoint has nothing left to resume.
  if (!stopped && existsSync(CONFIG.checkpoint)) {
    try { unlinkSync(CONFIG.checkpoint); } catch { /* harmless */ }
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log("\nSummary");
  console.log(`  destinations : ${Math.min(destIndex + (stopped ? 1 : 0), destinations.length)} of ${destinations.length}`);
  console.log(`  tiles planned: ${plannedTiles.toLocaleString()}`);
  console.log(`  requests     : ${METRICS.requests.toLocaleString()}  (${METRICS.ok} ok, ${METRICS.failed} failed, ${METRICS.retries} retries)`);
  console.log(`  http status  : ${JSON.stringify(METRICS.byStatus)}`);
  if (Object.keys(METRICS.network).length) console.log(`  network      : ${JSON.stringify(METRICS.network)}`);
  if (METRICS.retiredTypes.size) console.log(`  retired types: ${[...METRICS.retiredTypes].join(", ")}`);
  console.log(`  unique places: ${places.length.toLocaleString()}`);
  console.log(`  runtime      : ${secs}s`);
  console.log(`  expires      : ${expires.toISOString()}`);
  console.log(`  output       : ${CONFIG.out}`);
  if (stopped) {
    console.log(`\nSTOPPED EARLY: ${stopped}. Re-run with --resume to continue.`);
    process.exit(3);
  }
}

// SIGINT leaves the last checkpoint in place; the partial output file is never
// written, so an interrupted run cannot leave a half-valid index behind.
process.on("SIGINT", () => {
  console.log("\nInterrupted. Re-run with --resume to continue from the last checkpoint.");
  process.exit(130);
});

main().catch((e) => {
  console.error("crawl failed:", e?.message ?? e);
  process.exit(1);
});
