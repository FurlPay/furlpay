// ---------------------------------------------------------------------------
// Overture Maps Foundation → universal_hotels seed normalization.
//
// WHY THIS IS A LIBRARY AND NOT PART OF THE SCRIPT
// The download half of harvesting (reach S3, scan Parquet) needs a network and
// DuckDB. The normalization half — deciding whether an Overture record is a
// lodging we can put on a map, and what it becomes — is pure, and it is where
// every bug that ends with a pin in the wrong place actually lives. Splitting
// them means this half is unit tested without touching a byte of network.
//
// LICENSING: Overture Places is CDLA-Permissive 2.0. Commercial use is
// permitted with no attribution requirement on the data itself. Records that
// Overture sourced FROM OpenStreetMap carry ODbL obligations downstream, which
// is why `sources` is preserved on the way through rather than discarded — a
// consumer that needs to attribute must be able to tell which rows require it.
//
// GERS: Overture's Global Entity Reference System id is stable across releases
// for the same real-world entity. That is what makes re-harvesting idempotent
// rather than duplicative, so it is the identity we key on.
// ---------------------------------------------------------------------------

/** Overture category values that are lodging. */
const LODGING_CATEGORIES: Record<string, string> = {
  hotel: "hotel",
  hotels: "hotel",
  resort: "resort",
  resorts: "resort",
  motel: "motel",
  hostel: "hostel",
  guest_house: "guest_house",
  guesthouse: "guest_house",
  bed_and_breakfast: "bed_and_breakfast",
  bed_breakfast: "bed_and_breakfast",
  inn: "hotel",
  lodging: "hotel",
  vacation_rental: "villa",
  cottage: "villa",
  villa: "villa",
  chalet: "villa",
  hostel_accommodation: "hostel",
  extended_stay_hotel: "extended_stay",
  apartment_hotel: "extended_stay",
};

/** Categories that LOOK like lodging and are not — each one a real false
 *  positive from the places theme. A restaurant inside a hotel carries
 *  "hotel" in its name constantly; it is not a place to sleep. */
const EXCLUDED_CATEGORIES = new Set([
  "restaurant",
  "bar",
  "cafe",
  "night_club",
  "spa",
  "casino",
  "real_estate_agent",
  "travel_agency",
  "parking",
  "event_venue",
]);

/** The shape we read out of an Overture places row. Deliberately loose: the
 *  release schema evolves, and a hard shape would fail the whole harvest on a
 *  field that was renamed. */
export interface OvertureRecord {
  id?: unknown;
  names?: { primary?: unknown } | unknown;
  categories?: { primary?: unknown; alternate?: unknown } | unknown;
  geometry?: { type?: unknown; coordinates?: unknown } | unknown;
  /** Some exports flatten the point into columns instead of GeoJSON. */
  lat?: unknown;
  lon?: unknown;
  longitude?: unknown;
  latitude?: unknown;
  addresses?: unknown;
  websites?: unknown;
  sources?: unknown;
  confidence?: unknown;
}

/** A seed line, matching what scripts/ingest-hotel-seeds.mts accepts. */
export interface LodgingSeed {
  name: string;
  latitude: number;
  longitude: number;
  propertyType: string;
  city?: string;
  countryCode?: string;
  address?: string;
  website?: string;
  overtureId: string;
  /** Overture's own 0-1 confidence, carried for triage — never for display. */
  confidence?: number;
}

export type RejectReason =
  | "no_gers_id"
  | "no_name"
  | "not_lodging"
  | "excluded_category"
  | "no_coordinates"
  | "coordinates_out_of_range"
  | "null_island"
  | "no_country";

export type NormalizeResult =
  | { ok: true; seed: LodgingSeed }
  | { ok: false; reason: RejectReason; id?: string };

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Overture nests names as `{ primary, common, rules }`. */
function primaryName(rec: OvertureRecord): string | undefined {
  const names = rec.names as { primary?: unknown } | undefined;
  return str(names?.primary);
}

function categories(rec: OvertureRecord): string[] {
  const c = rec.categories as { primary?: unknown; alternate?: unknown } | undefined;
  const out: string[] = [];
  const p = str(c?.primary);
  if (p) out.push(p.toLowerCase());
  if (Array.isArray(c?.alternate)) {
    for (const a of c.alternate as unknown[]) {
      const s = str(a);
      if (s) out.push(s.toLowerCase());
    }
  }
  return out;
}

/**
 * Pull coordinates out of whichever shape this export used.
 *
 * GeoJSON is [LONGITUDE, LATITUDE] — the reverse of how humans say it, and the
 * single most common way a harvest ends up with every hotel in the ocean off
 * west Africa. Ordering is asserted in the tests for exactly that reason.
 */
export function coordsOf(rec: OvertureRecord): { lat: number; lng: number } | null {
  const geom = rec.geometry as { coordinates?: unknown } | undefined;
  const coords = geom?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }

  const lat = Number(rec.lat ?? rec.latitude);
  const lng = Number(rec.lon ?? rec.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };

  return null;
}

/** First address entry, flattened. Overture stores a list. */
function addressOf(rec: OvertureRecord): { freeform?: string; locality?: string; country?: string } {
  const list = rec.addresses;
  const first = Array.isArray(list) ? (list[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) return {};
  return {
    freeform: str(first.freeform),
    locality: str(first.locality),
    country: str(first.country)?.toUpperCase(),
  };
}

function websiteOf(rec: OvertureRecord): string | undefined {
  const list = rec.websites;
  const first = Array.isArray(list) ? str((list as unknown[])[0]) : str(list);
  if (!first) return undefined;
  // Only http(s). A `tel:` or `mailto:` in this field would be rendered as a
  // booking link.
  if (!/^https?:\/\//i.test(first)) return undefined;
  return first.slice(0, 1024);
}

/** Map an Overture category to our property_type, or null if it is not lodging. */
export function propertyTypeFor(cats: string[]): string | null {
  for (const c of cats) {
    if (EXCLUDED_CATEGORIES.has(c)) return null;
  }
  for (const c of cats) {
    const mapped = LODGING_CATEGORIES[c];
    if (mapped) return mapped;
  }
  return null;
}

/**
 * Normalize one Overture record into a seed, or explain why it cannot be one.
 *
 * Every rejection is a TYPED REASON rather than a null, so the harvester can
 * report counts per reason. A harvest that silently drops 40% of its input
 * looks identical to one that worked; a harvest that says "38,000 rejected:
 * no_country" tells you the country filter is wrong.
 */
export function normalizeOvertureRecord(rec: OvertureRecord): NormalizeResult {
  const id = str(rec.id);
  if (!id) return { ok: false, reason: "no_gers_id" };

  const name = primaryName(rec);
  if (!name) return { ok: false, reason: "no_name", id };

  const cats = categories(rec);
  if (cats.length === 0) return { ok: false, reason: "not_lodging", id };
  if (cats.some((c) => EXCLUDED_CATEGORIES.has(c))) {
    return { ok: false, reason: "excluded_category", id };
  }

  const propertyType = propertyTypeFor(cats);
  if (!propertyType) return { ok: false, reason: "not_lodging", id };

  const coords = coordsOf(rec);
  if (!coords) return { ok: false, reason: "no_coordinates", id };
  if (
    coords.lat < -90 || coords.lat > 90 ||
    coords.lng < -180 || coords.lng > 180
  ) {
    return { ok: false, reason: "coordinates_out_of_range", id };
  }
  // (0,0) is in the Gulf of Guinea and is almost always a missing-coordinate
  // sentinel rather than a property.
  if (coords.lat === 0 && coords.lng === 0) return { ok: false, reason: "null_island", id };

  const addr = addressOf(rec);
  // country_code is NOT NULL in migration 0015, so a record without one cannot
  // become a row. Rejecting here with a reason beats a Postgres constraint
  // error that fails the whole batch.
  if (!addr.country || !/^[A-Z]{2}$/.test(addr.country)) {
    return { ok: false, reason: "no_country", id };
  }

  const confidence = Number(rec.confidence);

  return {
    ok: true,
    seed: {
      name: name.slice(0, 300),
      latitude: coords.lat,
      longitude: coords.lng,
      propertyType,
      city: addr.locality?.slice(0, 160),
      countryCode: addr.country,
      address: addr.freeform?.slice(0, 500),
      website: websiteOf(rec),
      overtureId: id.slice(0, 128),
      confidence: Number.isFinite(confidence) ? confidence : undefined,
    },
  };
}

export interface HarvestSummary {
  seeds: LodgingSeed[];
  accepted: number;
  rejected: Record<RejectReason, number>;
}

/** Normalize a batch, keeping per-reason rejection counts. */
export function normalizeBatch(records: readonly OvertureRecord[]): HarvestSummary {
  const rejected: Record<RejectReason, number> = {
    no_gers_id: 0,
    no_name: 0,
    not_lodging: 0,
    excluded_category: 0,
    no_coordinates: 0,
    coordinates_out_of_range: 0,
    null_island: 0,
    no_country: 0,
  };
  const seeds: LodgingSeed[] = [];

  for (const rec of records) {
    const res = normalizeOvertureRecord(rec);
    if (res.ok) seeds.push(res.seed);
    else rejected[res.reason] += 1;
  }

  return { seeds, accepted: seeds.length, rejected };
}

/**
 * The DuckDB SQL that selects lodging from an Overture release.
 *
 * Built here rather than inline in the script so the filter is testable and
 * reviewable in one place. Parameters are interpolated as literals because
 * DuckDB's CLI has no bind syntax over `-c`, so every caller-supplied value is
 * validated by the caller before it reaches this function — see the script's
 * argument parsing.
 */
export function buildOvertureQuery(opts: {
  release: string;
  country?: string;
  bbox?: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  limit: number;
}): string {
  const categoryList = Object.keys(LODGING_CATEGORIES).map((c) => `'${c}'`).join(", ");
  const where: string[] = [
    `categories.primary IN (${categoryList})`,
  ];

  if (opts.country) where.push(`upper(addresses[1].country) = '${opts.country}'`);
  if (opts.bbox) {
    const b = opts.bbox;
    where.push(`bbox.xmin BETWEEN ${b.minLng} AND ${b.maxLng}`);
    where.push(`bbox.ymin BETWEEN ${b.minLat} AND ${b.maxLat}`);
  }

  return [
    "install spatial; load spatial;",
    "install httpfs; load httpfs;",
    "set s3_region='us-west-2';",
    "select",
    "  id,",
    "  names,",
    "  categories,",
    "  addresses,",
    "  websites,",
    "  sources,",
    "  confidence,",
    "  ST_AsGeoJSON(geometry) as geometry_json",
    `from read_parquet('s3://overturemaps-us-west-2/release/${opts.release}/theme=places/type=place/*', filename=true, hive_partitioning=1)`,
    `where ${where.join(" and ")}`,
    `limit ${opts.limit};`,
  ].join("\n");
}
