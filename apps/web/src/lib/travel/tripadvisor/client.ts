// ---------------------------------------------------------------------------
// Tripadvisor Terra client.
//
// WHAT WAS MEASURED, not assumed (2026-08-22, live against the API):
//
//   AUTH IS THE `X-API-Key` HEADER AND NOTHING ELSE. `?key=`, `?api_key=` and
//   `Authorization: Bearer` all return 401. Worth stating because three of the
//   four obvious guesses are wrong.
//
//   THREE ENDPOINTS EXIST: /catalog/locations/search, /catalog/locations/{id},
//   /catalog/locations/nearby. Reviews and photos 404 on every path tried;
//   they are not in this entitlement and are not implemented here.
//
//   NEARBY TAKES A BOUNDING BOX ONLY. The documented `radius` form returns 400,
//   so `searchNearby` accepts a box and this client never sends a radius.
//
//   THE LEGACY Content API IS OFF FOR EVERYONE — a deliberately invalid key
//   returns byte-identical 403 to a valid one. It sunsets 2026-08-31. Unused.
//
//   `location_type` IS ACCEPTED AND SILENTLY IGNORED. Filtered and unfiltered
//   responses were byte-identical: same total_elements, same result ids. This
//   client refuses to send it rather than implying a filter that does nothing.
//
//   TEXT SEARCH MATCHES NAMES, NOT PLACES. `query=Tokyo` returns "Tokyo
//   Teriyaki Restaurant" in Colorado. `searchLocations` is a NAME search and is
//   named to say so; geography goes through `searchNearby`.
//
// THE KEY IS READ FROM THE ENVIRONMENT AT CALL TIME AND NEVER RETURNED,
// LOGGED, OR PUT IN AN ERROR. Failures carry a reason, never a header or body.
// ---------------------------------------------------------------------------

import {
  TERRA_BASE,
  type TerraBounds,
  type TerraLocation,
  type TerraResult,
  type TerraSearchResponse,
} from "./types";

const TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;

/** Read at call time, not module load — a test or a redeploy can change it. */
function apiKey(): string | null {
  const k = process.env.TRIPADVISOR_API_KEY?.trim();
  return k ? k : null;
}

/** True when Terra can be called at all. Lets callers skip the work entirely. */
export function terraConfigured(): boolean {
  return apiKey() !== null;
}

/**
 * One request, with retries on the failures worth retrying.
 *
 * 429 and 5xx are transient and get backed off. 401 and 404 are not — retrying
 * a rejected credential just burns quota against a wall.
 */
async function request<T>(
  path: string,
  params: Record<string, string | number>
): Promise<TerraResult<T>> {
  const key = apiKey();
  if (!key) {
    // Fail closed. No request is attempted, so an unauthenticated call can
    // never reach Tripadvisor and no partial state leaks to the caller.
    return {
      ok: false,
      failure: "not_configured",
      detail:
        "TRIPADVISOR_API_KEY is not set. Discovery data is unavailable; booking is unaffected.",
    };
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const url = `${TERRA_BASE}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;

  let lastDetail = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Full jitter: a synchronised retry storm from many instances is worse
      // than the failure that triggered it.
      const backoff = Math.min(2000, 250 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, Math.random() * backoff));
    }

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "X-API-Key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "network error";
      lastDetail = msg;
      const timedOut = /abort|timeout/i.test(msg);
      if (attempt === MAX_RETRIES) {
        return timedOut
          ? { ok: false, failure: "timeout", detail: "Tripadvisor timed out." }
          : { ok: false, failure: "upstream_error", detail: msg };
      }
      continue;
    }

    if (res.ok) {
      try {
        return { ok: true, value: (await res.json()) as T };
      } catch {
        // A 200 that will not parse is malformed, not transient.
        return { ok: false, failure: "malformed", detail: "Tripadvisor returned unparseable JSON." };
      }
    }

    // Deliberately excludes the response body: Terra echoes the request in
    // some errors, and the request carries the credential.
    lastDetail = `HTTP ${res.status}`;

    if (res.status === 401 || res.status === 403) {
      return { ok: false, failure: "unauthorized", detail: "Tripadvisor rejected the credential." };
    }
    if (res.status === 404) {
      return { ok: false, failure: "not_found", detail: "No such Tripadvisor location." };
    }
    if (res.status === 429) {
      if (attempt === MAX_RETRIES) {
        return { ok: false, failure: "rate_limited", detail: "Tripadvisor rate limit." };
      }
      continue;
    }
    if (res.status >= 500) {
      if (attempt === MAX_RETRIES) {
        return { ok: false, failure: "upstream_error", detail: lastDetail };
      }
      continue;
    }
    // A 4xx that is none of the above means a bad parameter. Retrying cannot help.
    return { ok: false, failure: "upstream_error", detail: lastDetail };
  }

  return { ok: false, failure: "upstream_error", detail: lastDetail || "exhausted retries" };
}

/**
 * Search Terra by NAME.
 *
 * Named `searchLocations` rather than `searchCity` on purpose: this matches the
 * location's name, not its geography. A query of "Tokyo" returns restaurants in
 * Colorado called "Tokyo Teriyaki". Callers who want places in a city must use
 * `searchNearby`. Measured, not assumed — see the header.
 *
 * There is no `location_type` option because Terra ignores the parameter.
 */
export async function searchLocations(
  query: string,
  opts: { page?: number } = {}
): Promise<TerraResult<TerraSearchResponse>> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, failure: "malformed", detail: "Query must not be empty." };
  }
  const params: Record<string, string | number> = { query: trimmed };
  if (opts.page && opts.page > 1) params.page = opts.page;
  return request<TerraSearchResponse>("/catalog/locations/search", params);
}

/** One location by Terra id. Returns the same shape as a search row. */
export async function getLocation(id: number): Promise<TerraResult<TerraLocation>> {
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, failure: "not_found", detail: "Location id must be a positive integer." };
  }
  return request<TerraLocation>(`/catalog/locations/${id}`, {});
}

/**
 * Geographic search over a bounding box.
 *
 * The box is the only form that works — Terra's documented `radius` returns
 * 400 — so this signature cannot express a radius and the client never sends one.
 */
export async function searchNearby(
  bounds: TerraBounds,
  opts: { page?: number } = {}
): Promise<TerraResult<TerraSearchResponse>> {
  const { swLat, swLon, neLat, neLon } = bounds;
  if (![swLat, swLon, neLat, neLon].every((n) => Number.isFinite(n))) {
    return { ok: false, failure: "malformed", detail: "Bounding box requires four finite coordinates." };
  }
  if (swLat > neLat || swLon > neLon) {
    return { ok: false, failure: "malformed", detail: "Bounding box corners are inverted." };
  }
  const params: Record<string, string | number> = {
    sw_lat: swLat,
    sw_lon: swLon,
    ne_lat: neLat,
    ne_lon: neLon,
  };
  if (opts.page && opts.page > 1) params.page = opts.page;
  return request<TerraSearchResponse>("/catalog/locations/nearby", params);
}

/**
 * A box around a point, so callers can think in radius even though Terra
 * cannot. Converted here rather than sent, because Terra 400s on `radius`.
 *
 * Longitude degrees shrink as latitude rises, so the conversion divides by
 * cos(lat). A fixed degree box would be right only at the equator and far too
 * narrow everywhere else.
 */
export function boundsAround(lat: number, lon: number, radiusKm: number): TerraBounds {
  const latDelta = radiusKm / 111.32;
  const cos = Math.cos((lat * Math.PI) / 180);
  // Guard the pole: cos approaches 0 and the longitude delta would explode.
  const lonDelta = radiusKm / (111.32 * Math.max(0.01, Math.abs(cos)));
  return {
    swLat: Math.max(-90, lat - latDelta),
    swLon: Math.max(-180, lon - lonDelta),
    neLat: Math.min(90, lat + latDelta),
    neLon: Math.min(180, lon + lonDelta),
  };
}
