// ---------------------------------------------------------------------------
// Domain verification: is this website actually the property's?
//
// THE ATTACK THIS EXISTS TO STOP. Type a hotel's name into any search engine
// and the first results include affiliate pages, OTA landing pages, and
// outright lookalike booking sites built to intercept direct bookings. All of
// them contain the hotel's name, its photos, and its address, because copying
// those is trivial. A verifier that accepts "the domain contains the hotel
// name" or "the page mentions the address" will confidently hand a user a
// phishing site — and this product's entire promise is that the link is safe.
//
// SO NAME AND ADDRESS MATCHES DO NOT ESTABLISH OWNERSHIP. They corroborate. The
// two signals that actually establish it are:
//
//   1. THE REGISTRY NAMES THE DOMAIN. Asserted by a public authority, not
//      inferred by us. Unforgeable without compromising the registry.
//
//   2. THE SITE PUBLISHES THE REGISTRATION NUMBER. A fraudster must then also
//      publish a real number that resolves to the real property — which points
//      the victim at the genuine business and defeats the fraud.
//
// Everything else in this file is scored as corroboration and cannot, on its
// own, produce a VERIFIED status. See confidence.ts, where that rule is
// structural rather than a threshold.
// ---------------------------------------------------------------------------

import { createHash } from "crypto";
import { safeFetch } from "./safeFetch";
import type { Evidence, EvidenceKind, Registration, TrustFinding } from "./types";

/** Booking engines whose presence tells us a page can actually take a booking. */
const BOOKING_ENGINES: { name: string; patterns: RegExp[] }[] = [
  { name: "Lodgify", patterns: [/lodgify\.(com|net)/i] },
  { name: "Guesty", patterns: [/guesty(bookings)?\.com/i] },
  { name: "Hostaway", patterns: [/hostaway\.com/i] },
  { name: "OwnerRez", patterns: [/ownerrez\.com/i] },
  { name: "Smoobu", patterns: [/smoobu\.(com|net)/i] },
  { name: "Uplisting", patterns: [/uplisting\.io/i] },
  { name: "Mews", patterns: [/mews\.(com|li)/i] },
  { name: "Cloudbeds", patterns: [/cloudbeds\.com/i] },
  { name: "SiteMinder", patterns: [/siteminder\.com|thebookingbutton\.com/i] },
  { name: "Little Hotelier", patterns: [/littlehotelier\.com/i] },
  { name: "Beds24", patterns: [/beds24\.com/i] },
  { name: "SynXis", patterns: [/synxis\.com/i] },
];

/**
 * Domains that must never be presented as a property's "official site".
 *
 * Two categories, both dangerous for the same reason: a user told "this is the
 * official site" will trust the link. An OTA is not the property's own channel
 * (and sending automated traffic there is what this whole design avoids); a
 * link shortener hides where it actually goes.
 */
const NEVER_OFFICIAL = [
  /(^|\.)airbnb\./i,
  /(^|\.)booking\.com$/i,
  /(^|\.)vrbo\./i,
  /(^|\.)expedia\./i,
  /(^|\.)agoda\./i,
  /(^|\.)hotels\.com$/i,
  /(^|\.)tripadvisor\./i,
  /(^|\.)trivago\./i,
  /(^|\.)makemytrip\./i,
  /(^|\.)goibibo\./i,
  /(^|\.)bit\.ly$/i,
  /(^|\.)tinyurl\.com$/i,
  /(^|\.)t\.co$/i,
];

export function isDisallowedAsOfficial(hostname: string): boolean {
  return NEVER_OFFICIAL.some((re) => re.test(hostname));
}

/** Strip accents, punctuation and case so "Hôtel Sant Jordi" ≈ "hotel sant jordi". */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Does the page state this name?
 *
 * Requires ALL significant tokens, not a substring: "Villa Serena" must not
 * match a page about "Serena Apartments". Tokens under four characters are
 * dropped because "the", "casa" and "hotel" are noise that would let almost any
 * page match almost any property.
 */
export function nameAppears(haystack: string, name: string): boolean {
  const text = normalizeText(haystack);
  const tokens = normalizeText(name).split(" ").filter((t) => t.length >= 4);
  if (tokens.length === 0) return false;
  return tokens.every((t) => text.includes(t));
}

/** Digits only, so "+351 291 234 567" matches "291234567". */
export function phoneAppears(haystack: string, phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return false;
  const tail = digits.slice(-9);
  return haystack.replace(/\D/g, "").includes(tail);
}

/**
 * Does the page publish this registration number?
 *
 * Tolerant of separators and spacing because sites print licences every way
 * imaginable — "ETV/1234", "ETV 1234", "ETV-1234" are one number.
 */
export function registrationAppears(haystack: string, registrationNumber: string): boolean {
  const stripped = registrationNumber.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (stripped.length < 4) return false;
  return haystack.replace(/[^a-z0-9]/gi, "").toLowerCase().includes(stripped);
}

export interface VerifyInput {
  url: string;
  propertyName: string;
  registration?: Registration | null;
  /** Domain the registry itself published, when it publishes one. */
  registryDomain?: string | null;
  address?: string | null;
  phone?: string | null;
}

export interface VerifyResult {
  reachable: boolean;
  finalUrl: string | null;
  evidence: Evidence[];
  findings: TrustFinding[];
  bookingEngine: string | null;
  /** A page on this site that can take a booking, when one is identifiable. */
  bookingUrl: string | null;
  refusal: string | null;
}

/**
 * Verify a candidate website against a property's known identity.
 *
 * Fetches through `safeFetch`, so every SSRF defence applies and each redirect
 * hop is re-validated — a candidate that redirects into private space is
 * refused at the hop, not after.
 */
export async function verifyWebsite(input: VerifyInput): Promise<VerifyResult> {
  const now = () => new Date().toISOString();
  const evidence: Evidence[] = [];
  const findings: TrustFinding[] = [];

  let hostname: string;
  try {
    hostname = new URL(input.url).hostname.toLowerCase();
  } catch {
    return {
      reachable: false, finalUrl: null, evidence, findings,
      bookingEngine: null, bookingUrl: null,
      refusal: "The candidate URL could not be parsed.",
    };
  }

  if (isDisallowedAsOfficial(hostname)) {
    findings.push({
      signal: "suspicious_booking_domain",
      severity: "critical",
      detail: `${hostname} is a booking platform or link shortener, not a property's own website.`,
    });
    return {
      reachable: false, finalUrl: null, evidence, findings,
      bookingEngine: null, bookingUrl: null,
      refusal: `${hostname} cannot be presented as an official property website.`,
    };
  }

  const fetched = await safeFetch(input.url);
  if (!fetched.ok) {
    return {
      reachable: false, finalUrl: null, evidence, findings,
      bookingEngine: null, bookingUrl: null,
      refusal: `Could not retrieve the site (${fetched.reason}): ${fetched.detail}`,
    };
  }

  const html = fetched.body;
  const sourceHash = createHash("sha256").update(html).digest("hex").slice(0, 16);
  const finalUrl = fetched.url;
  const finalHost = new URL(finalUrl).hostname.toLowerCase();

  // A redirect that lands on an OTA means the "official site" is a parked
  // domain forwarding to a listing. Not the property's own channel.
  if (isDisallowedAsOfficial(finalHost)) {
    findings.push({
      signal: "suspicious_booking_domain",
      severity: "critical",
      detail: `${hostname} redirects to ${finalHost}, which is a booking platform rather than the property's own site.`,
    });
    return {
      reachable: true, finalUrl, evidence, findings,
      bookingEngine: null, bookingUrl: null,
      refusal: "The candidate redirects to a booking platform.",
    };
  }

  const add = (kind: EvidenceKind, supports: boolean, detail: string) =>
    evidence.push({
      kind, supports, detail,
      source: finalHost, sourceUrl: finalUrl, retrievedAt: now(), sourceHash,
    });

  // TLS is the transport we actually used, not a claim about the certificate's
  // contents — Node validated the chain or the fetch would have failed.
  if (finalUrl.startsWith("https://")) {
    add("tls_valid", true, "Served over HTTPS with a valid certificate chain.");
  } else {
    findings.push({
      signal: "suspicious_booking_domain",
      severity: "warning",
      detail: "The site is served over plain HTTP. Do not enter payment details there.",
    });
  }

  // ---- The two signals that actually establish ownership ----------------

  if (input.registryDomain) {
    const registryHost = input.registryDomain.toLowerCase().replace(/^www\./, "");
    const candidate = finalHost.replace(/^www\./, "");
    const matches = candidate === registryHost || candidate.endsWith(`.${registryHost}`);
    add("domain_in_registry", matches,
      matches
        ? `The registry lists ${registryHost} as this property's website.`
        : `The registry lists ${registryHost}, but this candidate is ${candidate}.`);
    if (!matches) {
      findings.push({
        signal: "domain_mismatch",
        severity: "critical",
        detail: `The registry names ${registryHost}; this site is ${candidate}.`,
      });
    }
  }

  if (input.registration?.number) {
    const present = registrationAppears(html, input.registration.number);
    if (present) {
      add("license_on_site", true, `The site publishes registration ${input.registration.number}.`);
    }
    // ABSENCE IS NOT A CONTRADICTION. Plenty of legitimate sites do not print
    // their licence on the page we happened to fetch. Recording it as
    // conflicting evidence would penalise honest properties.
  }

  // ---- Corroboration ----------------------------------------------------

  add("name_match_on_site", nameAppears(html, input.propertyName),
    nameAppears(html, input.propertyName)
      ? "The property's name appears on the page."
      : "The property's name does not appear on the page.");
  if (!nameAppears(html, input.propertyName)) {
    findings.push({
      signal: "name_mismatch",
      severity: "warning",
      detail: "The candidate site does not mention this property by name.",
    });
  }

  if (input.address && nameAppears(html, input.address)) {
    add("address_match_on_site", true, "The registered address appears on the page.");
  }
  if (input.phone && phoneAppears(html, input.phone)) {
    add("phone_match_on_site", true, "The registered phone number appears on the page.");
  }

  // schema.org LodgingBusiness / Hotel — a property describing itself in
  // machine-readable terms, which a thrown-together scam page rarely bothers with.
  if (/"@type"\s*:\s*"(Hotel|LodgingBusiness|BedAndBreakfast|Resort|VacationRental|Apartment)"/i.test(html)) {
    add("structured_data", true, "The page publishes structured lodging data.");
  }

  // ---- Booking engine ---------------------------------------------------

  let bookingEngine: string | null = null;
  let bookingUrl: string | null = null;
  for (const engine of BOOKING_ENGINES) {
    if (engine.patterns.some((re) => re.test(html))) {
      bookingEngine = engine.name;
      add("booking_engine_detected", true, `${engine.name} booking engine detected on the site.`);
      // The engine's own URL, when the page links to it — that is where a
      // booking is actually taken.
      const link = new RegExp(
        `https?://[^"'\\s<>]*${engine.patterns[0].source.replace(/[()\\]/g, "")}[^"'\\s<>]*`,
        "i"
      ).exec(html);
      if (link) bookingUrl = link[0];
      break;
    }
  }

  return { reachable: true, finalUrl, evidence, findings, bookingEngine, bookingUrl, refusal: null };
}
