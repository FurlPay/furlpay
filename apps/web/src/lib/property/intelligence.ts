// ---------------------------------------------------------------------------
// PropertyIntelligence — the trust layer under FurlPay Travels.
//
// This is INFRASTRUCTURE, not a destination. It runs over inventory FurlPay
// already has, attaches a trust assessment to each property, and hands that to
// the search ranker, the booking card, Trip Match and the MCP agent. It never
// sends a user off-platform: FurlPay is the booking platform, and a trust layer
// whose call to action is "go book somewhere else" would be working against the
// product it is supposed to protect.
//
// GROUNDED IN WHAT ACTUALLY GOES WRONG IN 2026, not in theory:
//
//   IMPERSONATION IS THE DOMINANT ATTACK. April 2026's Booking.com incident
//   compromised hotel-PARTNER accounts, not the platform's own backend, and
//   produced "reservation hijacking" — criminals holding genuine booking
//   details and posing as the property. So a trust layer's job is not only
//   "does this property exist" but "is the channel we are about to send money
//   through actually the property's".
//
//   AN IMPLAUSIBLY LOW PRICE IS A FRAUD SIGNAL, NOT A BARGAIN. Booking.com's
//   own fraud tooling flags suspiciously low rates. This is the inversion that
//   matters most here: naive marketplace logic surfaces the cheapest result
//   first, which is precisely the ranking a scam listing is engineered to win.
//   `priceOutlier` below treats a rate far under its peer set as a REASON TO
//   DOUBT rather than a reason to promote.
//
//   DUPLICATE AND LOOKALIKE LISTINGS are how one bad actor becomes many. The
//   detector works over a whole result set for that reason — a duplicate is
//   invisible when you inspect one property at a time.
//
// EVERY ASSESSMENT IS EVIDENCE-BACKED. Nothing here promotes a property for
// being popular, cheap, or highly rated, and no badge is shown that the
// evidence does not support. See confidence.ts — the score is derived, and
// VERIFIED is a structural claim rather than a threshold.
// ---------------------------------------------------------------------------

import { scoreConfidence } from "./confidence";
import { lookupRegistration, providerForNumber } from "./registry";
import { isDisallowedAsOfficial, nameAppears, normalizeText } from "./verify";
import type {
  Evidence,
  Registration,
  TrustFinding,
  VerificationStatus,
} from "./types";

/** The minimum a property must carry for us to assess it at all. */
export interface PropertyInput {
  id: string;
  name: string;
  city: string;
  country?: string | null;
  address?: string | null;
  /** Registration/licence number, when the provider supplies one. */
  registrationNumber?: string | null;
  /** The property's own domain, when the provider supplies one. */
  website?: string | null;
  nightlyUsd: number;
  stars?: number;
  rating?: number;
  reviews?: number;
  /** Which inventory provider returned it. Part of the trust picture: a
   *  contracted provider carries more weight than an open feed. */
  provider: string;
}

/**
 * The assessment attached to every property.
 *
 * `status` and `confidence` are for FurlPay's own ranking and risk decisions.
 * `badge` is the only field intended for a normal user, and it is deliberately
 * coarse — a traveller does not need an evidence array, and showing a precise
 * percentage next to a price invites it to be read as a quality score.
 */
export interface PropertyTrust {
  propertyId: string;
  status: VerificationStatus;
  confidence: number;
  evidence: Evidence[];
  contradictions: TrustFinding[];
  /** What the UI may display. Null means show nothing at all — never a
   *  reassuring placeholder. */
  badge: TrustBadge | null;
  /** True when this property should not be sold at all. */
  suppress: boolean;
  checkedAt: string;
}

export interface TrustBadge {
  label: string;
  tone: "verified" | "neutral" | "caution";
  /** Shown on hover/tap. Says what was actually checked. */
  detail: string;
}

const now = () => new Date().toISOString();

/**
 * Peer-relative price outlier detection.
 *
 * Uses the MEDIAN and median absolute deviation, not the mean and standard
 * deviation. A single fraudulent $9 listing drags a mean down and inflates a
 * standard deviation, which widens the band and lets the outlier through — the
 * exact failure the detector exists to prevent. The median is unmoved by it.
 *
 * Returns null when the peer set is too small to say anything; three hotels in
 * a city is not a distribution.
 */
export function priceOutlier(
  nightly: number,
  peers: number[]
): { isOutlier: boolean; median: number; ratio: number } | null {
  const sample = peers.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (sample.length < 8) return null;

  const mid = Math.floor(sample.length / 2);
  const median =
    sample.length % 2 === 0 ? (sample[mid - 1] + sample[mid]) / 2 : sample[mid];
  if (!(median > 0)) return null;

  const ratio = nightly / median;
  // Under 35% of the local median, for real inventory in one city on one set
  // of dates, is not a deal — it is a listing that wants to be clicked.
  return { isOutlier: ratio < 0.35, median, ratio };
}

/**
 * Duplicate and lookalike detection across a result set.
 *
 * Two failure modes, one detector. A genuine duplicate (the same property
 * listed twice) inflates a bad actor's surface area; a lookalike ("Marriot
 * Tokyo" beside "Marriott Tokyo") is impersonation. Both are only visible with
 * the whole set in hand.
 */
export function findDuplicates(properties: PropertyInput[]): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const p of properties) {
    // Normalised name + city. Deliberately not including the price: two
    // listings of the same property at different prices is the interesting
    // case, not one to be missed.
    const key = `${normalizeText(p.name)}|${normalizeText(p.city)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), p.id]);
  }
  const dupes = new Map<string, string[]>();
  for (const [key, ids] of byKey) {
    if (ids.length > 1) dupes.set(key, ids);
  }
  return dupes;
}

/**
 * Assess one property.
 *
 * `peers` are the other nightly rates in the same result set, used for the
 * outlier check. Passing an empty array simply skips it rather than producing
 * a false signal.
 */
export async function assessProperty(
  property: PropertyInput,
  context: { peers?: number[]; duplicateIds?: string[] } = {}
): Promise<PropertyTrust> {
  const evidence: Evidence[] = [];
  const contradictions: TrustFinding[] = [];
  const checkedAt = now();

  const add = (
    kind: Evidence["kind"],
    supports: boolean,
    source: string,
    detail: string,
    sourceUrl: string | null = null
  ) => evidence.push({ kind, supports, source, sourceUrl, retrievedAt: checkedAt, detail });

  // ---- Registration -----------------------------------------------------
  let registration: Registration | null = null;
  if (property.registrationNumber) {
    const provider = providerForNumber(property.registrationNumber);
    if (provider) {
      const { outcome } = await lookupRegistration(property.registrationNumber);
      if (outcome.result === "found") {
        registration = outcome.registration;
        add("registry_match", true, provider.authority, `Registered as ${outcome.registration.number}.`, outcome.sourceUrl);
        if (outcome.registration.status === "active") {
          add("registry_status_active", true, provider.authority, "Registration is active.", outcome.sourceUrl);
        } else {
          contradictions.push({
            signal: "registration_inactive",
            severity: "critical",
            detail: `The registration is ${outcome.registration.status}, not active.`,
          });
        }
      } else if (outcome.result === "not_found") {
        // The registry answered and did not have it. In a jurisdiction where
        // registration is the legal title to operate, that is serious.
        add("registry_match", false, provider.authority, "The registry returned no record for this number.", outcome.sourceUrl);
        contradictions.push({
          signal: "registration_mismatch",
          severity: "critical",
          detail: `${provider.authority} has no record of ${property.registrationNumber}.`,
        });
      }
      // `unsupported` and `error` add nothing either way — we could not ask,
      // which is not evidence about the property.
    } else {
      // A licence number in a shape no authority we model issues. Worth
      // noting, not worth accusing over.
      contradictions.push({
        signal: "missing_registration",
        severity: "info",
        detail: "The registration number is in a format we cannot attribute to an authority.",
      });
    }
  } else if (property.country && ["PT", "ES", "FR"].includes(property.country.toUpperCase())) {
    // These jurisdictions REQUIRE a number on any advertised listing. Its
    // absence is a genuine gap rather than a neutral silence.
    contradictions.push({
      signal: "missing_registration",
      severity: "warning",
      detail: `Properties in ${property.country.toUpperCase()} must display a registration number; none was supplied.`,
    });
  }

  // ---- Supplied website -------------------------------------------------
  if (property.website) {
    try {
      const host = new URL(property.website).hostname.toLowerCase();
      if (isDisallowedAsOfficial(host)) {
        contradictions.push({
          signal: "suspicious_booking_domain",
          severity: "warning",
          detail: `The supplied website is ${host}, which is a booking platform rather than the property's own site.`,
        });
      } else if (nameAppears(host.replace(/[.-]/g, " "), property.name)) {
        // Weak corroboration only. A domain containing the name is trivially
        // registered by anyone — it is why domain similarity can never
        // establish ownership on its own. See verify.ts.
        add("domain_age", true, "provider", `Provider supplied ${host} as the property website.`);
      }
    } catch {
      contradictions.push({
        signal: "domain_mismatch",
        severity: "info",
        detail: "The supplied website URL could not be parsed.",
      });
    }
  }

  // ---- Price outlier ----------------------------------------------------
  const outlier = priceOutlier(property.nightlyUsd, context.peers ?? []);
  if (outlier?.isOutlier) {
    contradictions.push({
      signal: "suspicious_booking_domain",
      severity: "warning",
      detail:
        `$${property.nightlyUsd}/night is ${Math.round(outlier.ratio * 100)}% of the ` +
        `$${Math.round(outlier.median)} median for comparable stays here. An implausibly low ` +
        "rate is a common signal of a fraudulent listing rather than a genuine deal.",
    });
  }

  // ---- Duplicates -------------------------------------------------------
  if (context.duplicateIds && context.duplicateIds.length > 1) {
    contradictions.push({
      signal: "duplicate_registration",
      severity: "warning",
      detail: `This property appears ${context.duplicateIds.length} times in the same result set.`,
    });
  }

  const { score, status } = scoreConfidence(evidence, contradictions);

  // A property is only withheld from sale on a registry contradiction — the
  // registry saying "no such registration" or "not active". Everything else is
  // a signal to weigh, and suppressing on a weak signal would quietly delist
  // legitimate hosts.
  const suppress = contradictions.some(
    (c) => c.severity === "critical" && (c.signal === "registration_mismatch" || c.signal === "registration_inactive")
  );

  return {
    propertyId: property.id,
    status,
    confidence: score,
    evidence,
    contradictions,
    badge: badgeFor(status, contradictions),
    suppress,
    checkedAt,
  };
}

/**
 * What a traveller is shown.
 *
 * Returns null far more often than it returns a badge, and that is correct:
 * most properties in most countries cannot be registry-verified because most
 * countries have no public register. Showing "Verification unavailable" on
 * every one of them would be noise that trains people to ignore the badge that
 * matters. Silence is the honest default; the badge appears when there is
 * something real to say.
 */
function badgeFor(status: VerificationStatus, contradictions: TrustFinding[]): TrustBadge | null {
  if (contradictions.some((c) => c.severity === "critical")) {
    return {
      label: "Under review",
      tone: "caution",
      detail: "We found information about this property that does not match its registration. It is being reviewed.",
    };
  }
  if (status === "VERIFIED") {
    return {
      label: "Property verified",
      tone: "verified",
      detail: "A government registry confirms this property, and its official website is tied to that record.",
    };
  }
  if (status === "PARTIALLY_VERIFIED") {
    return {
      label: "Registration confirmed",
      tone: "neutral",
      detail: "This property's registration was confirmed with the issuing authority.",
    };
  }
  return null;
}

/**
 * Assess a whole result set.
 *
 * The set-level view is what makes duplicates and price outliers detectable at
 * all, so this — not `assessProperty` — is what the search pipeline should
 * call.
 */
export async function assessResultSet(properties: PropertyInput[]): Promise<Map<string, PropertyTrust>> {
  const peers = properties.map((p) => p.nightlyUsd);
  const duplicates = findDuplicates(properties);
  const dupeByProperty = new Map<string, string[]>();
  for (const ids of duplicates.values()) {
    for (const id of ids) dupeByProperty.set(id, ids);
  }

  const assessed = await Promise.all(
    properties.map((p) =>
      assessProperty(p, { peers, duplicateIds: dupeByProperty.get(p.id) }).catch(
        (): PropertyTrust => ({
          // An assessment that threw must not remove a property from sale.
          // Failing closed here would delist inventory because of a bug in
          // our own code, which is a worse outcome than an unbadged listing.
          propertyId: p.id,
          status: "UNVERIFIED",
          confidence: 0,
          evidence: [],
          contradictions: [],
          badge: null,
          suppress: false,
          checkedAt: now(),
        })
      )
    )
  );

  return new Map(assessed.map((a) => [a.propertyId, a]));
}

/**
 * The trust component of search ranking.
 *
 * A small multiplier, not a sort key. Trust should nudge an otherwise-equal
 * pair, never bury a cheaper, better-located property because its country has
 * no register — that would systematically demote everything outside a handful
 * of European jurisdictions.
 */
export function rankingWeight(trust: PropertyTrust): number {
  if (trust.suppress) return 0;
  if (trust.contradictions.some((c) => c.severity === "critical")) return 0.5;
  if (trust.status === "VERIFIED") return 1.15;
  if (trust.status === "PARTIALLY_VERIFIED") return 1.05;
  return 1;
}

/**
 * The structured view an AI agent receives.
 *
 * Deliberately narrow. An agent acting on this is deciding whether to spend
 * someone's money, so it gets the status and the reasons — never a marketing
 * summary, and never a field we could not substantiate.
 */
export function forAgent(trust: PropertyTrust): {
  trustStatus: VerificationStatus;
  trustConfidence: number;
  verifiedBy: string[];
  concerns: string[];
  sellable: boolean;
  checkedAt: string;
} {
  return {
    trustStatus: trust.status,
    trustConfidence: trust.confidence,
    verifiedBy: [...new Set(trust.evidence.filter((e) => e.supports).map((e) => e.source))],
    concerns: trust.contradictions.map((c) => c.detail),
    sellable: !trust.suppress,
    checkedAt: trust.checkedAt,
  };
}
