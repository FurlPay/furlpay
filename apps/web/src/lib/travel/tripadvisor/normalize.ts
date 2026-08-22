// ---------------------------------------------------------------------------
// Terra -> FurlPay normalisation.
//
// Turns a Terra row into the two things this codebase already knows how to
// consume, and nothing else:
//
//   VERIFICATION EVIDENCE   `urls.official` becomes an Evidence record for
//                           lib/property/confidence.ts.
//
//   RANKING INPUT           `overall_rating.rating` and `.count` feed the
//                           Bayesian shrinkage in lib/travel/ranking.ts.
//
// WHAT IT REFUSES TO INVENT. Terra returns no price, no availability, and no
// category. This module therefore produces no price, no availability, and no
// category — a normaliser that guessed any of them would be laundering a guess
// into a field that looks retrieved. Absent stays null.
//
// THE ONE JUDGEMENT CALL WORTH ARGUING WITH is how much a Tripadvisor URL
// assertion is worth. It is scored as corroboration, not proof: Tripadvisor is
// a large well-run business whose listings are nonetheless partly maintained by
// the listed businesses themselves, so its `official` field is a claim by an
// interested party filtered through a third party. That is genuinely better
// than inferring a domain from a name, and genuinely worse than a government
// registry naming it. It is given its own evidence kind so the distinction
// survives into the confidence score rather than being flattened.
// ---------------------------------------------------------------------------

import type { Evidence } from "@/lib/property/types";
import { isDisallowedAsOfficial } from "@/lib/property/verify";
import type { TerraLocation } from "./types";

/** A Terra row reduced to the fields FurlPay stores. */
export interface NormalizedLocation {
  /** Stable external identity. `(source, externalId)` is the uniqueness key. */
  source: "tripadvisor";
  externalId: string;

  canonicalName: string;
  /** Alternate spellings Terra supplied. Searchable; never displayed as the name. */
  aliases: string[];

  description: string | null;

  city: string | null;
  state: string | null;
  country: string | null;
  /** ISO 3166-1 alpha-2, uppercased. Routes the registry lookup. */
  countryCode: string | null;
  postalCode: string | null;
  address: string | null;

  latitude: number | null;
  longitude: number | null;

  /** Raw Tripadvisor rating, 1-5. NEVER shown as a FurlPay score. */
  rating: number | null;
  /** How many reviews back it. Without this the rating cannot be ranked on. */
  reviewCount: number | null;

  /** The property's own site, as Tripadvisor asserts it. Null when absent. */
  officialUrl: string | null;
  /**
   * The Tripadvisor listing page. Kept separate — it is not an official site.
   *
   * Taken from `urls.tripadvisor.main`: the field is an object, not a string.
   * A live call threw on `.trim()` before this was corrected.
   */
  tripadvisorUrl: string | null;

  fetchedAt: string;
}

function firstText(items: { value?: string | null }[] | null | undefined): string | null {
  if (!items) return null;
  for (const i of items) {
    const v = i?.value?.trim();
    if (v) return v;
  }
  return null;
}

/**
 * Normalise a URL for storage and comparison.
 *
 * Returns null rather than a best guess when the input will not parse — a
 * malformed URL stored as though it were valid becomes a broken link presented
 * to a user as the property's official site.
 */
export function normalizeUrl(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname.includes(".")) return null;
  // Drop a trailing slash on a bare origin so the same site compares equal
  // whether or not Terra included it.
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
  return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? `:${u.port}` : ""}${path}${u.search}`;
}

/** Normalise one Terra location. Never throws; missing fields become null. */
export function normalizeLocation(loc: TerraLocation): NormalizedLocation {
  const names = loc.names ?? [];
  const primary = names.find((n) => n?.primary) ?? names[0];
  const canonicalName = primary?.value?.trim() || `Tripadvisor ${loc.id}`;

  // Aliases are everything that is not the canonical name, de-duplicated
  // case-insensitively — Terra repeats casing variants of the same string.
  const seen = new Set([canonicalName.toLowerCase()]);
  const aliases: string[] = [];
  for (const n of names) {
    const v = n?.value?.trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    aliases.push(v);
  }

  const addr = loc.addresses?.[0] ?? null;
  const coords = loc.coordinates ?? null;
  const rating = loc.overall_rating ?? null;

  const officialRaw = normalizeUrl(loc.urls?.official);
  // An OTA or shortener is never an "official site", whoever asserts it.
  // isDisallowedAsOfficial already encodes that list for the verifier; reusing
  // it keeps one definition rather than two that can drift apart.
  let officialUrl: string | null = null;
  if (officialRaw) {
    try {
      officialUrl = isDisallowedAsOfficial(new URL(officialRaw).hostname) ? null : officialRaw;
    } catch {
      officialUrl = null;
    }
  }

  return {
    source: "tripadvisor",
    externalId: String(loc.id),
    canonicalName,
    aliases,
    description: firstText(loc.descriptions),
    city: addr?.city?.trim() || null,
    state: addr?.state?.trim() || null,
    country: addr?.country_name?.trim() || null,
    countryCode: addr?.country_code?.trim().toUpperCase() || null,
    postalCode: addr?.postal_code?.trim() || null,
    address: addr?.formatted?.trim() || addr?.street_address?.trim() || null,
    latitude: typeof coords?.latitude === "number" ? coords.latitude : null,
    longitude: typeof coords?.longitude === "number" ? coords.longitude : null,
    rating: typeof rating?.rating === "number" ? rating.rating : null,
    reviewCount: typeof rating?.count === "number" ? rating.count : null,
    officialUrl,
    tripadvisorUrl: normalizeUrl(loc.urls?.tripadvisor?.main),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Turn a normalised location into verification evidence.
 *
 * Emits at most one record, and only when Terra actually named a site. No
 * official URL means no evidence — not weak evidence, and certainly not an
 * inferred domain.
 *
 * `kind: "domain_age"` is deliberate and is the weakest slot in the scoring
 * table. It cannot be `domain_in_registry`: that kind means a government
 * authority named the domain, and inflating a third-party assertion into it
 * would let a Tripadvisor listing alone reach VERIFIED. confidence.ts treats
 * VERIFIED as a structural claim about registry evidence, and this must not be
 * the thing that satisfies it.
 */
export function toVerificationEvidence(n: NormalizedLocation): Evidence[] {
  if (!n.officialUrl) return [];
  return [
    {
      kind: "domain_age",
      supports: true,
      source: "Tripadvisor",
      sourceUrl: n.tripadvisorUrl,
      retrievedAt: n.fetchedAt,
      detail:
        `Tripadvisor lists ${n.officialUrl} as this property's official website. ` +
        "A third-party listing is corroboration, not proof of ownership — listings " +
        "are partly maintained by the businesses themselves.",
    },
  ];
}

/**
 * The ranking inputs, when both are present.
 *
 * Returns null unless rating AND count are both real numbers. A rating with no
 * count cannot be shrunk toward the mean, and feeding it in as though it had
 * one review would penalise a property for a gap in Terra's data.
 */
export function toRatingInput(
  n: NormalizedLocation
): { rating: number; reviews: number } | null {
  if (typeof n.rating !== "number" || typeof n.reviewCount !== "number") return null;
  if (!(n.rating > 0) || n.reviewCount < 0) return null;
  return { rating: n.rating, reviews: n.reviewCount };
}

/**
 * Does this normalised row match a name the user typed?
 *
 * Checks the canonical name and every alias, so "four seasons chiyoda" resolves
 * to "Four Seasons Hotel Tokyo At Marunouchi" — Terra supplies exactly that
 * alias and a canonical-only match would miss it.
 */
export function matchesName(n: NormalizedLocation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (n.canonicalName.toLowerCase().includes(q)) return true;
  return n.aliases.some((a) => a.toLowerCase().includes(q));
}

/** De-duplicate on `(source, externalId)`. Later rows win — they are fresher. */
export function dedupe(rows: NormalizedLocation[]): NormalizedLocation[] {
  const byId = new Map<string, NormalizedLocation>();
  for (const r of rows) byId.set(`${r.source}:${r.externalId}`, r);
  return [...byId.values()];
}
