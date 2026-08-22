// ---------------------------------------------------------------------------
// The property intelligence model.
//
// DirectScout answers one question: "is this a real, registered property, and
// where is its own booking page?" Everything here exists to make that answer
// auditable — a claim the product makes must be traceable to a named source
// retrieved at a stated time.
//
// WHAT THIS SUBSYSTEM DOES NOT DO. It does not touch Airbnb, Booking.com, Vrbo
// or any other OTA. Their terms prohibit automated collection, and a product
// built on breaching them is a product with a shutdown date. Every input about
// an OTA listing comes from the USER, who is entitled to read a page they are
// looking at and tell us what it says.
//
// CONFIDENCE IS DERIVED, NEVER AUTHORED. See confidence.ts: the score is a sum
// over evidence that was actually collected. There is no branch anywhere that
// writes a number because it looks reassuring — a fabricated 96% next to a real
// price is worse than no score at all, because it invites a booking decision.
// ---------------------------------------------------------------------------

/**
 * How much of the property's identity has been established.
 *
 * NOT_FOUND is not fraud, and the distinction is load-bearing. Most of the
 * world has no queryable short-term-rental registry; a property in a
 * jurisdiction we cannot check is unverified, not suspect. Conflating the two
 * would libel the majority of legitimate hosts on earth.
 */
export type VerificationStatus =
  | "VERIFIED" // registry confirmed AND an official site tied to it
  | "PARTIALLY_VERIFIED" // some evidence, not the full chain
  | "UNVERIFIED" // nothing contradicts it, nothing confirms it
  | "NOT_FOUND"; // the identifiers we were given match no record

/** A single retrieved fact. Every claim the UI renders traces to one of these. */
export interface Evidence {
  kind: EvidenceKind;
  /** Human-readable source: "Turismo de Portugal RNAL", "property website". */
  source: string;
  /** Where it came from, so a reader can check it themselves. */
  sourceUrl: string | null;
  /** When we retrieved it. Displayed as "last verified" — never approximated. */
  retrievedAt: string;
  /** True when the evidence supports the identity, false when it contradicts it. */
  supports: boolean;
  detail: string;
  /** Hash of the raw source, so a later re-verification can tell whether the
   *  underlying page changed without re-reading the whole thing. */
  sourceHash?: string;
}

export type EvidenceKind =
  | "registry_match" // a government registry returned this property
  | "registry_status_active" // and the registration is current
  | "domain_in_registry" // the registry itself names the website
  | "name_match_on_site" // the site states the property's name
  | "address_match_on_site"
  | "phone_match_on_site"
  | "license_on_site" // the site displays the same registration number
  | "booking_engine_detected" // a known PMS booking widget is present
  | "structured_data" // schema.org LodgingBusiness / Hotel on the page
  | "tls_valid"
  | "domain_age"; // an established domain, not registered last week

/** Something that should give a reader pause. Reported, never hidden. */
export type TrustSignal =
  | "registration_mismatch"
  | "registration_inactive"
  | "address_mismatch"
  | "domain_mismatch"
  | "name_mismatch"
  | "duplicate_registration"
  | "missing_registration"
  | "suspicious_booking_domain"
  | "no_official_site_found";

export interface TrustFinding {
  signal: TrustSignal;
  severity: "info" | "warning" | "critical";
  detail: string;
}

export interface Jurisdiction {
  /** ISO-3166 alpha-2. */
  country: string;
  /** Sub-national region where registration is regional rather than national
   *  — Spain registers by autonomous community, so "ES" alone is not enough. */
  region?: string;
}

/** A registration as the registry itself reports it. */
export interface Registration {
  /** The number exactly as issued, e.g. "12345/AL", "ETV/1234", "HUTB-012345". */
  number: string;
  /** The registry that issued it. */
  authority: string;
  jurisdiction: Jurisdiction;
  status: "active" | "suspended" | "cancelled" | "unknown";
  /** Registered holder, where the registry publishes one. */
  holder?: string;
  registeredAddress?: string;
  /** Property type as the registry classifies it. */
  category?: string;
}

/**
 * The canonical property record.
 *
 * Every field is optional except the identity we were asked about, because a
 * property we could not verify still produces a useful record — one that says
 * plainly what could not be established.
 */
export interface PropertyRecord {
  /** Stable slug for /travel/property/[slug]. Derived from name + locality. */
  slug: string;
  /** The name as the most authoritative source states it, preferring the
   *  registry over the website over the user's input. */
  officialName: string;
  /** What the user called it, kept so the two can be compared. */
  providedName: string | null;

  address: string | null;
  locality: string | null;
  jurisdiction: Jurisdiction | null;
  coordinates: { lat: number; lng: number } | null;

  registration: Registration | null;

  /** The property's own site, only once ownership is evidenced. */
  officialWebsite: string | null;
  /** The page on that site where a booking can actually be made. */
  directBookingUrl: string | null;
  /** Which PMS runs the booking engine, when detectable. */
  bookingEngine: string | null;

  phone: string | null;
  email: string | null;

  status: VerificationStatus;
  /** 0-100, derived. See confidence.ts. */
  confidence: number;
  evidence: Evidence[];
  trustFindings: TrustFinding[];

  /** When this record was assembled. */
  verifiedAt: string;
  /** When it should be re-checked. Registries change slowly; sites do not. */
  staleAfter: string;
}

/**
 * A direct price, when the property's OWN site publishes one.
 *
 * Deliberately separate from the property record: a verified property with no
 * published price is still a good result — "here is the official booking page"
 * is most of the value — and bundling them would tempt a caller into treating
 * a missing price as a failed verification.
 */
export interface DirectRate {
  /** Total for the requested stay, in `currency`. */
  total: number | null;
  nightly: number | null;
  currency: string | null;
  checkIn: string;
  checkOut: string;
  /** Where the figure was read from. */
  sourceUrl: string;
  retrievedAt: string;
  /** True when the site published a price we could read; false when we reached
   *  the booking page but it required interaction we will not simulate. */
  published: boolean;
  note: string | null;
}

/**
 * The comparison, when the user has supplied an OTA total.
 *
 * `otaTotal` is USER-PROVIDED, always. We never retrieve it. The field name
 * says so and the API rejects a request that tries to have us fetch it.
 */
export interface Comparison {
  otaTotal: number;
  otaCurrency: string;
  /** What the user said the listing was, for their own reference. */
  otaSource: string | null;
  directTotal: number;
  directCurrency: string;
  /** Positive means direct is cheaper. Null when currencies differ and we
   *  have no rate we trust — a cross-currency "saving" computed from a stale
   *  rate is a number about nothing. */
  savings: number | null;
  savingsPct: number | null;
  /** Stated plainly on every comparison. */
  disclaimer: string;
}

export const OTA_TOTAL_DISCLAIMER =
  "The comparison figure is the total you told us the listing showed. FurlPay does not " +
  "retrieve prices from booking platforms. Direct prices come from the property's own website " +
  "and may exclude taxes or fees the platform included.";

/** How long a record stays fresh, by what produced it. */
export const TTL_SECONDS = {
  /** Registries are authoritative and change slowly. */
  registry: 30 * 24 * 3600,
  /** A property's own site changes more often, and prices constantly. */
  website: 24 * 3600,
  /** A published rate is the most perishable thing here. */
  rate: 900,
} as const;
