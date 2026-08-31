import type { LuxuryCategoryId } from "./luxuryTiers";
import type { ResolutionVerdict } from "./resolve";

// ---------------------------------------------------------------------------
// The shape of the curated luxury-property dataset.
//
// Split out from the loader so the resolver script and the runtime agree on one
// definition without the script pulling in "@/..." aliases or KV.
// ---------------------------------------------------------------------------

/** Where the coordinate a pin is drawn at actually came from. */
export type CoordinateSource = "google_places" | "curated_csv";

/**
 * How well the position is known.
 *
 *   exact        Google confirmed this property and we took its coordinate
 *   approximate  the curated coordinate, which is compiled rather than surveyed
 *
 * The UI renders the two differently. A property we could not confirm still
 * appears - dropping it would hide a real hotel - but it never claims a
 * precision it does not have.
 */
export type CoordinatePrecision = "exact" | "approximate";

/** What Google said, when it said anything. Evidence, kept for audit. */
export interface CuratedMatch {
  verdict: ResolutionVerdict;
  /** The name Google holds, which is often not the name the CSV holds. */
  resolvedName: string;
  nameSimilarity: number;
  /** max(Jaro-Winkler, token containment) - what the verdict was decided on. */
  nameEvidence: number;
  /** Metres between the curated coordinate and Google's. The correction size. */
  distanceMeters: number;
  /** How far the evidence entitled this candidate to sit. A correction close to
   *  its own ceiling is the one worth eyeballing in the audit. */
  distanceCeilingMeters: number;
  domainMatch: boolean;
  /** False when the domain is an operator domain shared across the corpus. */
  domainExclusive: boolean;
  cityMatch: boolean;
  brandMatch: boolean;
  /** A rival candidate scored too close to call, so the pin did not move. */
  ambiguous: boolean;
  runnerUpName?: string;
  /** How many candidates were assessed before this one won. */
  candidatesConsidered: number;
}

export interface CuratedProperty {
  id: string;
  name: string;
  brand?: string;
  propertyType: string;
  country: string;
  /** ISO 3166-1 alpha-2, resolved from the country name. */
  countryCode?: string;
  region: string;
  city: string;
  destination?: string;
  description: string;
  website?: string;

  categories: LuxuryCategoryId[];
  luxuryTier: string;
  stars?: number;
  michelinStatus?: string;
  flags: {
    overwater: boolean;
    skiAccess: boolean;
    heritage: boolean;
    vineyard: boolean;
    wellness: boolean;
    businessLuxury: boolean;
    cryptoPaymentVerified: boolean;
    helipad: boolean;
    airportTransfer: boolean;
  };

  /** The coordinate to draw. Best available, per `coordinateSource`. */
  latitude: number;
  longitude: number;
  precision: CoordinatePrecision;
  coordinateSource: CoordinateSource;
  /** The CSV's own coordinate, always retained so a correction is reversible
   *  and the size of every correction stays auditable. */
  curatedLatitude: number;
  curatedLongitude: number;

  /**
   * Google's place ID.
   *
   * The one piece of Places content the Places policy permits storing
   * indefinitely, which is why it is the anchor: a refresh re-reads the
   * coordinate from this ID rather than re-running a text search.
   */
  placeId?: string;
  googleMapsUri?: string;
  match?: CuratedMatch;
  /** When Google was last asked. Drives the staleness rule in the loader. */
  resolvedAt?: string;

  /** FurlPay L-Score, computed at build time. Ranking only. */
  lScore: number;

  /**
   * The Wikidata item this property was matched to, when one passed the gates
   * in scripts/enrich-luxury-properties.mts.
   *
   * Kept alongside the evidence for the same reason the Google match is: a
   * future reader has to be able to see WHY two records were judged to be one
   * building, not just that something decided they were.
   */
  wikidata?: {
    qid: string;
    matchedLabel: string;
    distanceMeters: number;
    nameEvidence: number;
    wikipediaUrl?: string;
    inceptionYear?: number;
  };

  /**
   * A stored photograph.
   *
   * PRESENT ONLY FOR COMMONS IMAGERY, and that is the whole point. Google's
   * Places photography may not be stored, so it never lands here — it is
   * fetched per view through /api/travel/hotels/preview. What is in this field
   * is CC-licensed, permanently addressable and safe to keep, which is what
   * lets the map show a picture without a billed call.
   */
  imageUrl?: string;
  imageThumbUrl?: string;
  imageSource?: "wikimedia_commons";
  /**
   * Path to the downloaded file under /public.
   *
   * PREFERRED OVER imageUrl WHEREVER IT EXISTS: a local file needs no third
   * party to be up, costs no round trip to commons.wikimedia.org, and cannot
   * change under the map. The remote URL stays as the fallback.
   */
  imageLocalPath?: string;
  /** Attribution. Required by the licence, so it travels with the file. */
  imageCredit?: string;
  imageLicence?: string;
  /** The Commons file page, so a reader can check the licence themselves. */
  imageSourcePage?: string;
  /** Which route found this picture — see download-property-images.mts. The
   *  proximity routes are the ones worth spot-checking. */
  imageRoute?: "p18" | "commons_category" | "wikipedia";

  /**
   * The CSV's own provenance note.
   *
   * Carried because it EXPLAINS A GAP: 58 rows say "official URL to be
   * confirmed", and those are exactly the rows with no website, which is in
   * turn why the resolver could not use a domain match on them. Without it,
   * a missing website looks like an oversight rather than a recorded state.
   */
  sourceNote?: string;
}

export interface CuratedDataset {
  generatedAt: string;
  /** When the Wikidata/Commons pass last ran, if it has. */
  enrichedAt?: string;
  /** When images were last downloaded. */
  imagesDownloadedAt?: string;
  sourceCsv: string;
  /** Rows read from the CSV. Compared against properties.length so a partial
   *  run cannot pass for a complete one. */
  sourceRows: number;
  counts: Record<ResolutionVerdict | "unqueried", number>;
  properties: CuratedProperty[];
}
