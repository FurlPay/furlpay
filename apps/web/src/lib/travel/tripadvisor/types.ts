// ---------------------------------------------------------------------------
// Tripadvisor Terra — response models.
//
// EVERY FIELD HERE IS OPTIONAL BECAUSE THE API MEASURABLY OMITS THEM. Coverage
// sampled over 20 Tokyo results on 2026-08-22:
//
//   addresses        20/20
//   overall_rating   20/20
//   coordinates      19/20
//   urls.official    15/20   <- the field this integration exists for
//   descriptions      6/20
//   names             1.3 average (one property carried 5 aliases)
//
// So `urls.official` is absent a quarter of the time and `descriptions` is
// absent most of the time. Code that assumes either is present will throw on
// real inventory, which is why the types force the check.
//
// TERRA IS A CONTENT API. It returns no prices, no availability, and no
// booking. Duffel remains the only thing in this codebase that can sell a
// room. Nothing here may be rendered as though it were live inventory.
// ---------------------------------------------------------------------------

/** Base URL. Path prefix `/api` is part of it — endpoints are `/catalog/...`. */
export const TERRA_BASE = "https://terra.tripadvisor.com/api";

/**
 * Measured coverage, kept next to the types so a reader sees why everything is
 * optional and can re-measure rather than trust a comment.
 */
export const MEASURED_COVERAGE = {
  sampledAt: "2026-08-22",
  sample: "20 results, query=Tokyo",
  addresses: 1.0,
  overallRating: 1.0,
  coordinates: 0.95,
  officialUrl: 0.75,
  descriptions: 0.3,
} as const;

export interface TerraName {
  language?: string | null;
  value: string;
  /** Exactly one entry is normally primary; the rest are search aliases. */
  primary?: boolean | null;
}

export interface TerraDescription {
  language?: string | null;
  value: string;
}

export interface TerraAddress {
  street_address?: string | null;
  street_address2?: string | null;
  city?: string | null;
  state?: string | null;
  country_name?: string | null;
  /** ISO 3166-1 alpha-2. Routes the property-registry lookup. */
  country_code?: string | null;
  postal_code?: string | null;
  language?: string | null;
  formatted?: string | null;
}

export interface TerraCoordinates {
  latitude?: number | null;
  longitude?: number | null;
}

export interface TerraRating {
  /** 1-5. */
  rating?: number | null;
  /** How many reviews back it. The whole reason ranking cannot sort on rating. */
  count?: number | null;
  icon_url?: string | null;
}

/**
 * The Tripadvisor listing links.
 *
 * An OBJECT, not a string — corrected after a live call threw on `.trim()`.
 * `photos` is a link to the listing's photo gallery as a WEB PAGE, which is
 * consistent with the photos API endpoints 404ing: the images are linkable,
 * not ingestible.
 */
export interface TerraTripadvisorUrls {
  main?: string | null;
  photos?: string | null;
  write_review?: string | null;
  questions_answers?: string | null;
}

export interface TerraUrls {
  /** The Tripadvisor listing. Never an "official site". */
  tripadvisor?: TerraTripadvisorUrls | null;
  /** Restaurant menu, when Terra has one. Observed on 2 of 20 rows. */
  menu?: string | null;
  /**
   * The property's OWN website, as Tripadvisor asserts it.
   *
   * This is the field the integration is for. lib/property/verify.ts holds
   * that domain similarity can never establish ownership — only a registry
   * naming the domain, or the site publishing its licence. A third party
   * asserting the domain is a genuine third anchor, weaker than a government
   * registry and stronger than anything inferred.
   */
  official?: string | null;
}

export interface TerraLocation {
  id: number;
  geo_id?: number | null;
  geo?: string | null;
  names?: TerraName[] | null;
  descriptions?: TerraDescription[] | null;
  addresses?: TerraAddress[] | null;
  coordinates?: TerraCoordinates | null;
  overall_rating?: TerraRating | null;
  urls?: TerraUrls | null;
}

export interface TerraPagination {
  page: number;
  size: number;
  total_pages: number;
  total_elements: number;
}

/** Search and nearby both wrap each location in `{ location: ... }`. */
export interface TerraSearchResponse {
  data: { location: TerraLocation }[];
  pagination: TerraPagination;
}

/** A bounding box. Terra's `radius` form returns 400; only this shape works. */
export interface TerraBounds {
  swLat: number;
  swLon: number;
  neLat: number;
  neLon: number;
}

export type TerraFailure =
  | "not_configured"
  | "unauthorized"
  | "rate_limited"
  | "not_found"
  | "upstream_error"
  | "timeout"
  | "malformed";

/**
 * Terra is optional infrastructure, so its client returns a result rather than
 * throwing. A discovery layer that could take down checkout would be a worse
 * product than one that quietly shows less.
 */
export type TerraResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: TerraFailure; detail: string };
