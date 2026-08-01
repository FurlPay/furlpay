// ---------------------------------------------------------------------------
// Travel-document wallet — domain model.
//
// WHAT THIS DELIBERATELY DOES NOT HOLD.
//
// No MRZ string. No chip data groups. No facial image, fingerprint or iris
// data. No "biometric hash". No document images. Under GDPR Article 9 a hash
// DERIVED from biometrics is still biometric processing — hashing does not
// change the category of the data, it only changes how hard it is to read. A
// travel-document feature that stores one needs a separate lawful basis, a DPIA
// and, in several jurisdictions, explicit regulatory notification.
//
// DG3 (fingerprint) and DG4 (iris) additionally require Extended Access
// Control, which needs a certificate signed by the issuing country. FurlPay
// will never hold one, so those groups are not merely unstored — they are
// unreachable, and any design that assumes them is wrong.
//
// What IS stored is what a travel product actually needs: that a document was
// verified, by whom, of what type, from which country, when it expires, and
// enough of a tail to tell two documents apart. Everything else stays with the
// verification provider, which is licensed to hold it.
//
// THE PROVIDER OWNS DOCUMENT CAPABILITY, NOT US. There is no per-country table
// of BAC/PACE support, chip data groups, or "ePassport since" years here. That
// information changes whenever a country reissues, cannot be verified at the
// scale of ~180 countries, and is already known accurately by Sumsub. A stale
// capability map that says a document is readable when it is not produces a
// user stuck in a flow that cannot succeed.
// ---------------------------------------------------------------------------

/** ICAO 9303 machine-readable document formats. */
export type DocumentFormat = "TD1" | "TD2" | "TD3";

export type DocumentType = "passport" | "passport_card" | "national_id" | "residence_permit";

export type DocumentStatus = "pending" | "verified" | "failed" | "expired";

export type Region = "americas" | "europe" | "asia_pacific" | "middle_east" | "africa";

/** Display metadata only — ISO 3166-1, which is stable and verifiable. */
export interface Country {
  /** ISO 3166-1 alpha-3. */
  code: string;
  /** ISO 3166-1 alpha-2 — used to pick a flag ASSET, never an emoji. */
  code2: string;
  name: string;
  region: Region;
}

/**
 * A stored travel document.
 *
 * `documentTail` is the last 4 characters of the document number and is the
 * ONLY part of it that exists in our storage. The full number is never
 * received, so it cannot leak from here.
 */
export interface TravelDocument {
  id: string;
  userId: string;
  type: DocumentType;
  /** ISO 3166-1 alpha-3 of the issuing state. */
  issuingCountry: string;
  /** Last 4 chars of the document number. Never the whole thing. */
  documentTail: string;
  /** ISO date. Used to warn before travel and to expire the entry. */
  expiresOn: string;
  status: DocumentStatus;
  /** Provider that performed verification, for audit. */
  verifiedBy: string;
  verifiedAt: string | null;
  /** Whether the chip was read, as reported by the provider. Display only. */
  chipVerified: boolean;
  label: string | null;
  isPrimary: boolean;
  createdAt: string;
}

/** Shape returned by the API. Structurally cannot carry a full number. */
export interface MaskedDocument {
  id: string;
  type: DocumentType;
  /** Human label for `type`. Sent by the server so the client never has to
   *  keep its own copy of the mapping and drift from it. */
  typeLabel: string;
  issuingCountry: string;
  countryName: string;
  /** Pre-masked for display, e.g. "•••• 6789". */
  documentNumberMasked: string;
  expiresOn: string;
  /** True within EXPIRY_WARNING_DAYS of expiry — many states refuse entry
   *  within 6 months of a passport expiring, so this warns early. */
  expiringSoon: boolean;
  expired: boolean;
  status: DocumentStatus;
  verifiedBy: string;
  verifiedAt: string | null;
  chipVerified: boolean;
  label: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  passport: "Passport",
  passport_card: "Passport card",
  national_id: "National ID",
  residence_permit: "Residence permit",
};

/** Many destinations require 6 months' validity beyond the date of entry. */
export const EXPIRY_WARNING_DAYS = 183;

/**
 * Mask a document for transport to a client.
 *
 * This is the single chokepoint between storage and any API response. It
 * BUILDS a new object field by field rather than spreading and deleting: a
 * spread carries forward every field the storage type gains in future,
 * including one someone adds without thinking about egress. Whitelisting means
 * a new sensitive field is invisible to clients until someone deliberately
 * adds it here.
 */
export function maskDocument(doc: TravelDocument, now: Date = new Date()): MaskedDocument {
  const expiry = new Date(doc.expiresOn);
  const msToExpiry = expiry.getTime() - now.getTime();
  const expired = Number.isFinite(expiry.getTime()) && msToExpiry <= 0;

  return {
    id: doc.id,
    type: doc.type,
    typeLabel: DOCUMENT_TYPE_LABEL[doc.type] ?? doc.type,
    issuingCountry: doc.issuingCountry,
    countryName: countryName(doc.issuingCountry),
    documentNumberMasked: maskTail(doc.documentTail),
    expiresOn: doc.expiresOn,
    expiringSoon:
      !expired && Number.isFinite(expiry.getTime()) && msToExpiry <= EXPIRY_WARNING_DAYS * 86_400_000,
    expired,
    // An expired document is not "verified" for any purpose a user cares
    // about, whatever the stored status says.
    status: expired && doc.status === "verified" ? "expired" : doc.status,
    verifiedBy: doc.verifiedBy,
    verifiedAt: doc.verifiedAt,
    chipVerified: doc.chipVerified,
    label: doc.label,
    isPrimary: doc.isPrimary,
    createdAt: doc.createdAt,
  };
}

/** "•••• 6789". Defensive: truncates anything longer than a tail. */
export function maskTail(tail: string): string {
  const clean = (tail ?? "").replace(/\s/g, "");
  // If a full number ever reaches this function — a bug upstream — mask it
  // rather than echoing it. Failing safe beats failing loudly here.
  const last4 = clean.length > 4 ? clean.slice(-4) : clean;
  return last4 ? `•••• ${last4}` : "••••";
}

/**
 * Reduce a document number to a storable tail.
 *
 * Called at the trust boundary, on the provider's response, so a full number
 * exists only inside one function scope and is never written anywhere.
 */
export function toTail(documentNumber: string): string {
  return (documentNumber ?? "").replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase();
}

// ── Countries ──────────────────────────────────────────────────────────────
//
// ISO 3166-1 display data. No capability claims: which documents a country's
// citizens can actually verify is the provider's answer, fetched at session
// creation, not a constant maintained here.

export const COUNTRIES: Country[] = [
  // Americas
  { code: "USA", code2: "US", name: "United States", region: "americas" },
  { code: "CAN", code2: "CA", name: "Canada", region: "americas" },
  { code: "MEX", code2: "MX", name: "Mexico", region: "americas" },
  { code: "BRA", code2: "BR", name: "Brazil", region: "americas" },
  { code: "ARG", code2: "AR", name: "Argentina", region: "americas" },
  { code: "CHL", code2: "CL", name: "Chile", region: "americas" },
  { code: "COL", code2: "CO", name: "Colombia", region: "americas" },
  { code: "PER", code2: "PE", name: "Peru", region: "americas" },
  // Europe
  { code: "GBR", code2: "GB", name: "United Kingdom", region: "europe" },
  { code: "IRL", code2: "IE", name: "Ireland", region: "europe" },
  { code: "DEU", code2: "DE", name: "Germany", region: "europe" },
  { code: "FRA", code2: "FR", name: "France", region: "europe" },
  { code: "ESP", code2: "ES", name: "Spain", region: "europe" },
  { code: "ITA", code2: "IT", name: "Italy", region: "europe" },
  { code: "NLD", code2: "NL", name: "Netherlands", region: "europe" },
  { code: "BEL", code2: "BE", name: "Belgium", region: "europe" },
  { code: "CHE", code2: "CH", name: "Switzerland", region: "europe" },
  { code: "AUT", code2: "AT", name: "Austria", region: "europe" },
  { code: "SWE", code2: "SE", name: "Sweden", region: "europe" },
  { code: "NOR", code2: "NO", name: "Norway", region: "europe" },
  { code: "DNK", code2: "DK", name: "Denmark", region: "europe" },
  { code: "FIN", code2: "FI", name: "Finland", region: "europe" },
  { code: "POL", code2: "PL", name: "Poland", region: "europe" },
  { code: "PRT", code2: "PT", name: "Portugal", region: "europe" },
  { code: "CZE", code2: "CZ", name: "Czechia", region: "europe" },
  { code: "GRC", code2: "GR", name: "Greece", region: "europe" },
  { code: "ROU", code2: "RO", name: "Romania", region: "europe" },
  { code: "EST", code2: "EE", name: "Estonia", region: "europe" },
  // Asia Pacific
  { code: "IND", code2: "IN", name: "India", region: "asia_pacific" },
  { code: "CHN", code2: "CN", name: "China", region: "asia_pacific" },
  { code: "JPN", code2: "JP", name: "Japan", region: "asia_pacific" },
  { code: "KOR", code2: "KR", name: "South Korea", region: "asia_pacific" },
  { code: "SGP", code2: "SG", name: "Singapore", region: "asia_pacific" },
  { code: "AUS", code2: "AU", name: "Australia", region: "asia_pacific" },
  { code: "NZL", code2: "NZ", name: "New Zealand", region: "asia_pacific" },
  { code: "MYS", code2: "MY", name: "Malaysia", region: "asia_pacific" },
  { code: "IDN", code2: "ID", name: "Indonesia", region: "asia_pacific" },
  { code: "THA", code2: "TH", name: "Thailand", region: "asia_pacific" },
  { code: "PHL", code2: "PH", name: "Philippines", region: "asia_pacific" },
  { code: "VNM", code2: "VN", name: "Vietnam", region: "asia_pacific" },
  { code: "PAK", code2: "PK", name: "Pakistan", region: "asia_pacific" },
  { code: "BGD", code2: "BD", name: "Bangladesh", region: "asia_pacific" },
  { code: "LKA", code2: "LK", name: "Sri Lanka", region: "asia_pacific" },
  { code: "NPL", code2: "NP", name: "Nepal", region: "asia_pacific" },
  { code: "TWN", code2: "TW", name: "Taiwan", region: "asia_pacific" },
  { code: "HKG", code2: "HK", name: "Hong Kong SAR", region: "asia_pacific" },
  // Middle East
  { code: "ARE", code2: "AE", name: "United Arab Emirates", region: "middle_east" },
  { code: "SAU", code2: "SA", name: "Saudi Arabia", region: "middle_east" },
  { code: "QAT", code2: "QA", name: "Qatar", region: "middle_east" },
  { code: "KWT", code2: "KW", name: "Kuwait", region: "middle_east" },
  { code: "BHR", code2: "BH", name: "Bahrain", region: "middle_east" },
  { code: "OMN", code2: "OM", name: "Oman", region: "middle_east" },
  { code: "ISR", code2: "IL", name: "Israel", region: "middle_east" },
  { code: "TUR", code2: "TR", name: "Türkiye", region: "middle_east" },
  { code: "JOR", code2: "JO", name: "Jordan", region: "middle_east" },
  // Africa
  { code: "ZAF", code2: "ZA", name: "South Africa", region: "africa" },
  { code: "NGA", code2: "NG", name: "Nigeria", region: "africa" },
  { code: "KEN", code2: "KE", name: "Kenya", region: "africa" },
  { code: "EGY", code2: "EG", name: "Egypt", region: "africa" },
  { code: "GHA", code2: "GH", name: "Ghana", region: "africa" },
  { code: "MAR", code2: "MA", name: "Morocco", region: "africa" },
  { code: "TZA", code2: "TZ", name: "Tanzania", region: "africa" },
  { code: "ETH", code2: "ET", name: "Ethiopia", region: "africa" },
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function getCountry(code: string): Country | undefined {
  return BY_CODE.get((code ?? "").toUpperCase());
}

/** Display name, falling back to the code so an unlisted country still renders
 *  something truthful rather than "undefined". */
export function countryName(code: string): string {
  return getCountry(code)?.name ?? (code ?? "").toUpperCase();
}

export function isSupportedCountry(code: string): boolean {
  return BY_CODE.has((code ?? "").toUpperCase());
}

/** Search by name or either ISO code. */
export function searchCountries(query: string): Country[] {
  const q = query.trim().toLowerCase();
  if (!q) return COUNTRIES;
  return COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().startsWith(q) ||
      c.code2.toLowerCase() === q
  );
}

export const REGION_LABEL: Record<Region, string> = {
  americas: "Americas",
  europe: "Europe",
  asia_pacific: "Asia Pacific",
  middle_east: "Middle East",
  africa: "Africa",
};

/** ICAO format for a document type. TD3 is the passport booklet; ID-1 sized
 *  cards are TD1. Used for provider session config and user instructions. */
export function formatFor(type: DocumentType): DocumentFormat {
  return type === "passport" ? "TD3" : "TD1";
}

