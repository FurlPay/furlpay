import { kvGet, kvSet } from "@/lib/kv";
import { log } from "@/lib/log";
import { orderedOverpassEndpoints, rememberOverpassEndpoint } from "./osmHotels";

// ---------------------------------------------------------------------------
// Nearby places around a hotel, from OpenStreetMap (Overpass).
//
// LAZY AND BOUNDED, BECAUSE OVERPASS OFTEN DOES NOT ANSWER FROM VERCEL.
// Measured on furlpay.com: the hotel lookup routinely takes ~33 s and then
// fails. So this is asked only when the reader opens "What's nearby" for one
// hotel, never during map load, and the WHOLE lookup — every mirror — has an
// 8 s budget. Past it the answer is "unavailable", said plainly.
//
// Provenance: every place here is an OpenStreetMap feature (ODbL), and the UI
// says so. Nothing is ranked, rated or described beyond what OSM records.
// ---------------------------------------------------------------------------

export type PoiCategory = "restaurant" | "cafe" | "attraction" | "museum" | "shopping" | "transport";

export interface Poi {
  id: string;
  name: string;
  category: PoiCategory;
  latitude: number;
  longitude: number;
}

export interface PoiResult {
  status: "ok" | "unavailable";
  pois: Poi[];
  fetchedAt: string;
}

export const POI_RADIUS_M = 900;
const TOTAL_BUDGET_MS = 8_000;
const QUERY_TIMEOUT_S = 7;
const CACHE_TTL_SECONDS = 24 * 3600;
const MAX_POIS = 80;

/** Which OSM tags mean which category. First match wins. */
export function categoryFor(tags: Record<string, string>): PoiCategory | null {
  if (tags.tourism === "museum" || tags.amenity === "arts_centre") return "museum";
  if (tags.tourism === "attraction" || tags.tourism === "viewpoint" || tags.historic === "monument") return "attraction";
  if (tags.amenity === "restaurant") return "restaurant";
  if (tags.amenity === "cafe") return "cafe";
  if (tags.shop === "mall" || tags.shop === "department_store") return "shopping";
  if (tags.railway === "station" || tags.public_transport === "station") return "transport";
  return null;
}

/** Parse Overpass elements into named, categorised places. Unnamed or
 *  uncategorised features are dropped rather than shown as "Unnamed". */
export function parsePoiElements(elements: unknown[]): Poi[] {
  const out: Poi[] = [];
  const seen = new Set<string>();
  for (const raw of elements) {
    const e = raw as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
    const tags = e.tags ?? {};
    const name = (tags["name:en"] || tags.name || "").trim();
    const category = categoryFor(tags);
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (!name || !category || typeof lat !== "number" || typeof lng !== "number") continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const key = `${category}:${name.toLowerCase()}`;
    if (seen.has(key)) continue; // one "Starbucks" per category is enough
    seen.add(key);
    out.push({ id: `${e.type ?? "n"}/${e.id ?? out.length}`, name: name.slice(0, 120), category, latitude: lat, longitude: lng });
    if (out.length >= MAX_POIS) break;
  }
  return out;
}

function query(lat: number, lng: number, r: number): string {
  const around = `(around:${r},${lat},${lng})`;
  return (
    `[out:json][timeout:${QUERY_TIMEOUT_S}];(` +
    `nwr["amenity"~"^(restaurant|cafe|arts_centre)$"]["name"]${around};` +
    `nwr["tourism"~"^(museum|attraction|viewpoint)$"]["name"]${around};` +
    `nwr["shop"~"^(mall|department_store)$"]["name"]${around};` +
    `nwr["railway"="station"]["name"]${around};` +
    `);out center 300;`
  );
}

export async function osmPoisNear(lat: number, lng: number, radiusM = POI_RADIUS_M): Promise<PoiResult> {
  const key = `osm:pois:${lat.toFixed(3)},${lng.toFixed(3)}:${radiusM}`;
  const cached = await kvGet<PoiResult>(key).catch(() => null);
  if (cached) return cached;

  const started = Date.now();
  for (const endpoint of orderedOverpassEndpoints()) {
    const left = TOTAL_BUDGET_MS - (Date.now() - started);
    if (left < 1_000) break;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), left);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: query(lat, lng, radiusM) }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "*/*",
          "User-Agent": "FurlPay/1.0 (+https://furlpay.com) hotel-map nearby",
        },
        signal: ac.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        log.warn("osm.pois.http", { endpoint, status: res.status });
        continue;
      }
      const json = (await res.json()) as { elements?: unknown[] };
      rememberOverpassEndpoint(endpoint);
      const result: PoiResult = { status: "ok", pois: parsePoiElements(json.elements ?? []), fetchedAt: new Date().toISOString() };
      await kvSet(key, result, CACHE_TTL_SECONDS).catch(() => {});
      return result;
    } catch (e) {
      log.warn("osm.pois.failed", { endpoint, error: (e as Error).message });
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: "unavailable", pois: [], fetchedAt: new Date().toISOString() };
}
