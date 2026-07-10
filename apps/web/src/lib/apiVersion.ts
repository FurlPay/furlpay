// ---------------------------------------------------------------------------
// API versioning — date-based versions negotiated via the `X-Api-Version`
// request header (the Stripe/Vanguard API-first pattern). The middleware
// resolves the version for every /api/* request, rejects unknown values with
// a 400 that lists supported versions, and stamps the resolved version (plus
// Deprecation/Sunset headers once a version is retired) on every response.
//
// Edge-safe: no Node APIs — this runs inside middleware.ts.
// ---------------------------------------------------------------------------

export interface ApiVersionConfig {
  deprecated: boolean;
  /** ISO date the version stops being served (only for deprecated versions). */
  sunset?: string;
}

export const API_VERSIONS = {
  "2026-07-01": { deprecated: false },
} as const satisfies Record<string, ApiVersionConfig>;

export type ApiVersion = keyof typeof API_VERSIONS;

export const LATEST_API_VERSION: ApiVersion = "2026-07-01";

export const SUPPORTED_API_VERSIONS = Object.keys(API_VERSIONS) as ApiVersion[];

/** Resolve the requested version. Absent header → latest (clients that don't
 *  pin get current behavior, matching how they behave today). Unknown value →
 *  `ok: false` so the middleware can 400 instead of silently serving the
 *  wrong contract. */
export function resolveApiVersion(
  header: string | null
): { ok: true; version: ApiVersion } | { ok: false; requested: string } {
  if (!header) return { ok: true, version: LATEST_API_VERSION };
  if (header in API_VERSIONS) return { ok: true, version: header as ApiVersion };
  return { ok: false, requested: header };
}

/** Stamp version headers on an outgoing response. Deprecated versions get the
 *  RFC 8594 Deprecation/Sunset pair plus a successor link for migration. */
export function applyApiVersionHeaders<T extends Response>(res: T, version: ApiVersion): T {
  res.headers.set("X-Api-Version", version);
  const config: ApiVersionConfig = API_VERSIONS[version];
  if (config.deprecated) {
    res.headers.set("Deprecation", "true");
    if (config.sunset) res.headers.set("Sunset", config.sunset);
    res.headers.set(
      "Link",
      '<https://docs.furlpay.com/api/versioning>; rel="successor-version"'
    );
  }
  return res;
}
