// ---------------------------------------------------------------------------
// Resolve the curated luxury-property CSV against Google Places, and emit the
// dataset the hotel map draws from.
//
//   node --experimental-strip-types apps/web/scripts/resolve-luxury-properties.mts \
//     --csv "furlpay_global_luxury_map_properties.csv"
//
// WHAT IT DOES. For each CSV row it asks Google Places for lodging near the
// curated coordinate, assesses EVERY candidate returned against hard gates and
// weighted evidence (see lib/hotels/resolve.ts), and writes the winner's
// coordinate only when the verdict is CONFIRMED. Anything less keeps the
// curated coordinate, flagged `approximate`. No row is ever dropped: a property
// we could not confirm is a real hotel we know less about, not a hotel that
// stopped existing.
//
// WHY THIS IS A SCRIPT AND NOT A REQUEST HANDLER. 507 text searches is an
// offline job with a bill attached, run when the CSV changes, not per pageview.
// The map then draws from a static artifact and makes zero Places calls.
//
// BILLING. The field mask decides the SKU, and a request bills at the highest
// tier any field in the mask belongs to. `websiteUri` is Enterprise; everything
// else here is Pro. The domain it yields is the single most decisive signal in
// the whole matcher - it is what identifies Wilderness Mombo as the CSV's
// "Mombo Camp" after the rename - so it is on by default and `--no-website`
// exists for a cheaper, blinder run.
//
// PLACES CONTENT AND STORAGE. The Places policy permits storing the place ID
// indefinitely and caching other content for a limited period. So `placeId` is
// the durable anchor, Google-derived coordinates carry `resolvedAt`, and the
// loader treats them as expired after CURATED_STALE_DAYS and falls back to the
// curated coordinate. Re-running this script refreshes them. Nothing else
// Google returns - ratings, photos, editorial summaries - is requested or
// written.
//
// FLAGS
//   --csv <path>        Source CSV. Default: repo-root furlpay_global_luxury_map_properties.csv
//   --out <path>        Output JSON. Default: apps/web/src/data/luxury-properties.json
//   --report <path>     Per-row audit CSV. Default: alongside --out
//   --limit <n>         Resolve only the first n rows (a cheap smoke test)
//   --only <substring>  Resolve only rows whose name contains this
//   --concurrency <n>   Parallel Places calls. Default 6
//   --no-website        Drop websiteUri from the mask (Pro SKU, weaker matching)
//   --dry-run           Assess nothing, just report what would be queried
//   --refresh-stale     Re-resolve only rows whose resolvedAt has expired
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveBestCandidate,
  toleranceMeters,
  countryCodeFromName,
  canonicalCountryCode,
  registrableDomain,
  type CuratedSubject,
  type PlaceCandidate,
} from "../src/lib/hotels/resolve";
import {
  lScore,
  matchBrand,
  BRAND_TIERS,
  type LuxuryCategoryId,
} from "../src/lib/hotels/luxuryTiers";
import type {
  CuratedDataset,
  CuratedProperty,
} from "../src/lib/hotels/curatedTypes";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..", "..");

// --- argv -------------------------------------------------------------------

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function bool(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const CSV_PATH = path.resolve(
  flag("csv") ?? path.join(REPO_ROOT, "furlpay_global_luxury_map_properties.csv")
);
const OUT_PATH = path.resolve(
  flag("out") ?? path.join(WEB_ROOT, "src", "data", "luxury-properties.json")
);
const REPORT_PATH = path.resolve(
  flag("report") ?? OUT_PATH.replace(/\.json$/, ".audit.csv")
);
const LIMIT = Number(flag("limit") ?? 0) || 0;
const ONLY = flag("only")?.toLowerCase();
const CONCURRENCY = Math.max(1, Math.min(12, Number(flag("concurrency") ?? 6) || 6));
const WANT_WEBSITE = !bool("no-website");
const DRY_RUN = bool("dry-run");
const REFRESH_STALE = bool("refresh-stale");

const API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

/** Google-derived coordinates are treated as expired past this. Mirrors the
 *  loader's own constant; both must agree or the artifact and the runtime would
 *  disagree about what is still usable. */
const STALE_DAYS = 30;

// --- CSV --------------------------------------------------------------------

/**
 * RFC 4180 parse. Hand-rolled rather than pulled in as a dependency: the file
 * has quoted fields containing commas (every description does) and nothing more
 * exotic, and a parser small enough to read is easier to trust than a
 * transitive dependency in a script that writes production data.
 */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter((r) => r.length > 1 && r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

function csvEscape(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const truthy = (v: string | undefined) => v === "true" || v === "TRUE" || v === "1" || v === "yes";

/** Stable id from the name, so re-running does not churn ids and a marker keeps
 *  its identity across regenerations. */
function slugId(name: string, country: string): string {
  const slug = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return `lux_${slug(country)}_${slug(name)}`.slice(0, 90);
}

// --- Google Places ----------------------------------------------------------

const PRO_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.businessStatus",
  "places.googleMapsUri",
];
const MASK = (WANT_WEBSITE ? [...PRO_FIELDS, "places.websiteUri"] : PRO_FIELDS).join(",");

const stats = { calls: 0, httpErrors: 0, retries: 0 };

async function searchText(
  textQuery: string,
  bias: { latitude: number; longitude: number; radius: number } | null,
  maxResultCount: number
): Promise<PlaceCandidate[] | null> {
  const body: Record<string, unknown> = { textQuery, maxResultCount };
  if (bias) {
    body.locationBias = {
      circle: {
        center: { latitude: bias.latitude, longitude: bias.longitude },
        radius: Math.min(50_000, Math.max(1, Math.round(bias.radius))),
      },
    };
  }

  // Three attempts, backing off. 429 and 5xx are transient; anything else is a
  // real answer and retrying it just spends money to be told the same thing.
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      stats.calls++;
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Header, never a query string: a URL ends up in logs and proxies.
          "X-Goog-Api-Key": API_KEY,
          "X-Goog-FieldMask": MASK,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.status === 429 || res.status >= 500) {
        stats.retries++;
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        stats.httpErrors++;
        const detail = await res.text().catch(() => "");
        console.error(`  ! HTTP ${res.status} ${detail.slice(0, 200)}`);
        return null;
      }

      const json = (await res.json()) as { places?: Record<string, any>[] };
      return (json.places ?? []).map(toCandidate).filter((p): p is PlaceCandidate => p !== null);
    } catch (e) {
      stats.retries++;
      if (attempt === 2) {
        console.error(`  ! ${(e as Error).message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function toCandidate(raw: Record<string, any>): PlaceCandidate | null {
  const id = typeof raw?.id === "string" ? raw.id : "";
  const name = raw?.displayName?.text;
  const lat = Number(raw?.location?.latitude);
  const lng = Number(raw?.location?.longitude);
  if (!id || typeof name !== "string" || !name) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null; // Null Island means "unknown"

  const country = (raw.addressComponents ?? []).find((c: any) =>
    Array.isArray(c?.types) && c.types.includes("country")
  )?.shortText;

  return {
    placeId: id,
    name,
    latitude: lat,
    longitude: lng,
    countryCode: typeof country === "string" ? country : undefined,
    formattedAddress:
      typeof raw.formattedAddress === "string" ? raw.formattedAddress : undefined,
    types: Array.isArray(raw.types) ? raw.types.filter((t: unknown) => typeof t === "string") : [],
    primaryType: typeof raw.primaryType === "string" ? raw.primaryType : undefined,
    websiteUri: typeof raw.websiteUri === "string" ? raw.websiteUri : undefined,
    businessStatus: typeof raw.businessStatus === "string" ? raw.businessStatus : undefined,
  };
}

/**
 * Query strings to try, in order, stopping at the first CONFIRMED result.
 *
 * WHY MORE THAN ONE. A bare name is ambiguous ("The Berkeley" exists in London
 * and in California) and a fully-qualified one is over-constrained for a
 * property whose CSV city is a region rather than a town ("Okavango Delta").
 * Trying the specific form first and relaxing costs a second call only for the
 * rows the first form failed, which measured at a small minority.
 */
function queryLadder(row: Record<string, string>): string[] {
  const name = row.property_name;
  const ladder = [
    [name, row.city, row.country].filter(Boolean).join(", "),
    [name, row.destination, row.country].filter(Boolean).join(", "),
    [name, row.country].filter(Boolean).join(", "),
    name,
  ];
  // Dedupe while preserving order: for a row whose city and destination agree,
  // the first two forms are identical and the second call would be wasted.
  return [...new Set(ladder)].filter(Boolean);
}

// --- amenity factor from the CSV's own flags --------------------------------

/**
 * The CSV records amenities as explicit booleans, so unlike the OSM path this
 * does not have to infer anything. A false is a recorded false; absence of a
 * column would be absence of evidence, and there is none here.
 */
function curatedAmenity(row: Record<string, string>): number {
  const signals: Array<[boolean, number]> = [
    [truthy(row.wellness), 15],
    [truthy(row.vineyard), 10],
    [truthy(row.overwater), 12],
    [truthy(row.heritage_property), 10],
    [truthy(row.ski_access), 8],
    [truthy(row.business_luxury), 8],
    [truthy(row.helipad), 12],
    [truthy(row.airport_transfer), 5],
    [row.michelin_status !== "" && row.michelin_status !== "None", 20],
  ];
  return Math.min(100, signals.reduce((sum, [ok, w]) => sum + (ok ? w : 0), 0));
}

// --- the run ----------------------------------------------------------------

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function loadPrevious(): Map<string, CuratedProperty> {
  if (!fs.existsSync(OUT_PATH)) return new Map();
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_PATH, "utf8")) as CuratedDataset;
    return new Map((prev.properties ?? []).map((p) => [p.id, p]));
  } catch {
    return new Map();
  }
}

function isFresh(p: CuratedProperty | undefined): boolean {
  if (!p?.resolvedAt) return false;
  const age = Date.now() - Date.parse(p.resolvedAt);
  return Number.isFinite(age) && age < STALE_DAYS * 86_400_000;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }
  if (!API_KEY && !DRY_RUN) {
    console.error(
      "GOOGLE_PLACES_API_KEY is not set. Export it (or GOOGLE_MAPS_API_KEY) and re-run.\n" +
        "Nothing was written: an unkeyed run would emit an artifact of entirely\n" +
        "unverified coordinates that looks exactly like a verified one."
    );
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(CSV_PATH, "utf8"));
  const sourceRows = rows.length;
  let selected = rows;
  if (ONLY) selected = selected.filter((r) => r.property_name.toLowerCase().includes(ONLY));
  if (LIMIT) selected = selected.slice(0, LIMIT);

  const previous = loadPrevious();

  // Domain -> how many curated rows publish it. Counted over the WHOLE csv, not
  // the selected subset, so a --limit run judges domain exclusivity the same way
  // a full run does and a smoke test cannot reach a different verdict.
  const domainCorpus = new Map<string, number>();
  for (const r of rows) {
    const d = registrableDomain(r.website);
    if (d) domainCorpus.set(d, (domainCorpus.get(d) ?? 0) + 1);
  }

  console.log(`CSV        ${CSV_PATH}`);
  console.log(`rows       ${sourceRows}${selected.length !== sourceRows ? ` (${selected.length} selected)` : ""}`);
  console.log(`mask       ${WANT_WEBSITE ? "Pro + websiteUri (Enterprise SKU)" : "Pro SKU"}`);
  console.log(`out        ${OUT_PATH}`);
  if (DRY_RUN) console.log("mode       DRY RUN - no Places calls, no artifact written");
  console.log("");

  const properties = await mapWithConcurrency(selected, CONCURRENCY, async (row, index) => {
    const id = slugId(row.property_name, row.country);
    const prior = previous.get(id);

    const curatedLat = Number(row.latitude);
    const curatedLng = Number(row.longitude);
    const countryCode = countryCodeFromName(row.country) ?? undefined;

    const brandHit = matchBrand({ brand: row.brand }, row.property_name);
    const stars = Number(row.star_rating) || undefined;
    const score = lScore({
      stars,
      brandPrestige: brandHit?.prestige ?? (row.brand && BRAND_TIERS[row.brand.toLowerCase()]?.prestige) ?? 0,
      amenity: curatedAmenity(row),
    });

    const base: CuratedProperty = {
      id,
      name: row.property_name,
      brand: row.brand || undefined,
      propertyType: row.property_type,
      country: row.country,
      countryCode,
      region: row.region,
      city: row.city,
      destination: row.destination || undefined,
      description: row.official_description,
      website: row.website || undefined,
      categories: (row.category_id ? row.category_id.split("|") : []).filter(
        Boolean
      ) as LuxuryCategoryId[],
      luxuryTier: row.luxury_tier,
      stars,
      michelinStatus: row.michelin_status && row.michelin_status !== "None" ? row.michelin_status : undefined,
      flags: {
        overwater: truthy(row.overwater),
        skiAccess: truthy(row.ski_access),
        heritage: truthy(row.heritage_property),
        vineyard: truthy(row.vineyard),
        wellness: truthy(row.wellness),
        businessLuxury: truthy(row.business_luxury),
        cryptoPaymentVerified: truthy(row.crypto_payment_verified),
        helipad: truthy(row.helipad),
        airportTransfer: truthy(row.airport_transfer),
      },
      // Default to the curated position. Only a CONFIRMED match overwrites it.
      latitude: curatedLat,
      longitude: curatedLng,
      precision: "approximate",
      coordinateSource: "curated_csv",
      curatedLatitude: curatedLat,
      curatedLongitude: curatedLng,
      lScore: score.score,
    };

    if (!Number.isFinite(curatedLat) || !Number.isFinite(curatedLng)) {
      console.log(`[${index + 1}/${selected.length}] ${row.property_name} — SKIPPED, unusable curated coordinate`);
      return base;
    }

    // --refresh-stale: keep a still-fresh prior result rather than paying for
    // it again. The verdict and the coordinate carry over intact.
    if (REFRESH_STALE && isFresh(prior)) {
      return { ...base, ...carryOver(prior) };
    }
    if (DRY_RUN) return base;

    const tol = toleranceMeters(row.latitude, row.longitude);
    const subject: CuratedSubject = {
      name: row.property_name,
      latitudeText: row.latitude,
      longitudeText: row.longitude,
      country: row.country,
      city: row.city || undefined,
      brand: row.brand || undefined,
      website: row.website || undefined,
    };

    // How many curated rows publish this row's domain. 30 rows sharing
    // aman.com means a domain match proves "an Aman", not "this Aman".
    const domainCount = domainCorpus.get(registrableDomain(row.website) ?? "") ?? 1;

    let bestSoFar: ReturnType<typeof resolveBestCandidate>["best"] = null;
    let ambiguous = false;
    let runnerUp: string | undefined;
    let considered = 0;

    for (const query of queryLadder(row)) {
      const candidates = await searchText(
        query,
        { latitude: curatedLat, longitude: curatedLng, radius: tol.search },
        5
      );
      if (!candidates?.length) continue;
      considered += candidates.length;

      const result = resolveBestCandidate(subject, candidates, domainCount);
      if (result.best && (!bestSoFar || result.best.score > bestSoFar.score)) {
        bestSoFar = result.best;
        ambiguous = result.ambiguous;
        runnerUp = result.runnerUpName;
      }
      // A confirmed match cannot be improved on by a vaguer query, so stop
      // rather than spend another call to reconfirm it.
      if (bestSoFar?.verdict === "confirmed") break;
    }

    if (!bestSoFar) {
      console.log(`[${index + 1}/${selected.length}] ${row.property_name} — UNRESOLVED (${considered} candidates)`);
      return base;
    }

    const confirmed = bestSoFar.verdict === "confirmed";
    const moved = Math.round(bestSoFar.distanceMeters);
    console.log(
      `[${index + 1}/${selected.length}] ${row.property_name} — ${bestSoFar.verdict.toUpperCase()}` +
        ` "${bestSoFar.candidate.name}" ${moved}m` +
        (bestSoFar.domainExclusive ? " domain!" : bestSoFar.domainMatch ? " domain" : "") +
        (ambiguous ? ` AMBIGUOUS vs "${runnerUp}"` : "") +
        (confirmed ? "" : "  (coordinate kept)")
    );

    return {
      ...base,
      // Only CONFIRMED moves the pin. A probable match records what we found
      // without acting on it.
      latitude: confirmed ? bestSoFar.candidate.latitude : curatedLat,
      longitude: confirmed ? bestSoFar.candidate.longitude : curatedLng,
      precision: confirmed ? ("exact" as const) : ("approximate" as const),
      coordinateSource: confirmed ? ("google_places" as const) : ("curated_csv" as const),
      countryCode: canonicalCountryCode(bestSoFar.candidate.countryCode) ?? countryCode,
      placeId: bestSoFar.candidate.placeId,
      googleMapsUri: `https://www.google.com/maps/place/?q=place_id:${bestSoFar.candidate.placeId}`,
      resolvedAt: new Date().toISOString(),
      match: {
        verdict: bestSoFar.verdict,
        resolvedName: bestSoFar.candidate.name,
        nameSimilarity: Math.round(bestSoFar.nameSimilarity * 1000) / 1000,
        nameEvidence: Math.round(bestSoFar.nameEvidence * 1000) / 1000,
        distanceMeters: moved,
        distanceCeilingMeters: Math.round(bestSoFar.distanceCeilingMeters),
        domainMatch: bestSoFar.domainMatch,
        domainExclusive: bestSoFar.domainExclusive,
        cityMatch: bestSoFar.cityMatch,
        brandMatch: bestSoFar.brandMatch,
        ambiguous,
        runnerUpName: runnerUp,
        candidatesConsidered: considered,
      },
    };
  });

  if (DRY_RUN) {
    console.log(`\nDry run complete. ${selected.length} rows would be queried.`);
    return;
  }

  const counts = { confirmed: 0, probable: 0, rejected: 0, unqueried: 0 };
  for (const p of properties) {
    if (!p.match) counts.unqueried++;
    else counts[p.match.verdict]++;
  }

  const dataset: CuratedDataset = {
    generatedAt: new Date().toISOString(),
    sourceCsv: path.basename(CSV_PATH),
    sourceRows,
    counts,
    // Sorted by latitude so the loader's index is built from an already-ordered
    // array and a diff between two runs stays readable.
    properties: properties.sort((a, b) => a.latitude - b.latitude),
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(dataset, null, 1));

  // The audit CSV is the point of the exercise: every correction, its size, and
  // the evidence behind it, in a form that can be sorted and eyeballed.
  const header = [
    "id", "name", "resolved_name", "verdict", "precision", "moved_meters",
    "ceiling_meters", "name_similarity", "name_evidence", "domain_match",
    "domain_exclusive", "city_match", "brand_match", "ambiguous", "runner_up",
    "candidates", "country", "city", "csv_lat", "csv_lng", "final_lat", "final_lng",
    "place_id", "google_maps_uri",
  ];
  const lines = [header.join(",")];
  for (const p of dataset.properties) {
    lines.push([
      p.id, p.name, p.match?.resolvedName ?? "", p.match?.verdict ?? "unqueried",
      p.precision, p.match?.distanceMeters ?? "", p.match?.distanceCeilingMeters ?? "",
      p.match?.nameSimilarity ?? "", p.match?.nameEvidence ?? "",
      p.match?.domainMatch ?? "", p.match?.domainExclusive ?? "",
      p.match?.cityMatch ?? "", p.match?.brandMatch ?? "",
      p.match?.ambiguous ?? "", p.match?.runnerUpName ?? "",
      p.match?.candidatesConsidered ?? "", p.country, p.city,
      p.curatedLatitude, p.curatedLongitude, p.latitude, p.longitude,
      p.placeId ?? "", p.googleMapsUri ?? "",
    ].map(csvEscape).join(","));
  }
  fs.writeFileSync(REPORT_PATH, lines.join("\n"));

  const corrections = dataset.properties
    .filter((p) => p.precision === "exact" && p.match)
    .map((p) => p.match!.distanceMeters)
    .sort((a, b) => a - b);
  const median = corrections.length ? corrections[Math.floor(corrections.length / 2)] : 0;
  const over500 = corrections.filter((d) => d > 500).length;

  console.log("");
  console.log(`confirmed  ${counts.confirmed}/${selected.length}  (coordinate replaced with Google's)`);
  console.log(`probable   ${counts.probable}\t(place id recorded, curated coordinate kept)`);
  console.log(`unresolved ${counts.unqueried}\t(no candidate passed the gates)`);
  console.log(`corrections median ${median}m, ${over500} moved more than 500m`);
  console.log(`Places calls ${stats.calls} (retries ${stats.retries}, hard errors ${stats.httpErrors})`);
  console.log("");
  console.log(`artifact   ${OUT_PATH}`);
  console.log(`audit      ${REPORT_PATH}`);
}

/** Fields worth carrying over from a previous, still-fresh run. */
function carryOver(prior: CuratedProperty) {
  return {
    latitude: prior.latitude,
    longitude: prior.longitude,
    precision: prior.precision,
    coordinateSource: prior.coordinateSource,
    placeId: prior.placeId,
    googleMapsUri: prior.googleMapsUri,
    match: prior.match,
    resolvedAt: prior.resolvedAt,
  };
}

await main();
