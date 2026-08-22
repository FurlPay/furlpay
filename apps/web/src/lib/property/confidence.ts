// ---------------------------------------------------------------------------
// Confidence, derived.
//
// The brief said: do not invent confidence scores. This file is how that
// promise is kept — the score is a pure function of evidence that was actually
// collected, with a fixed weight per evidence kind, and there is no path that
// writes a number for any other reason.
//
// WHY THE WEIGHTS ARE WHAT THEY ARE. They rank by how hard the signal is to
// forge, not by how nice it looks:
//
//   A GOVERNMENT REGISTRY MATCH is the strongest thing available. Someone must
//   have filed with a public authority, and the record is independently
//   checkable by anyone reading the same registry.
//
//   THE REGISTRY NAMING THE DOMAIN is the single best domain signal, because
//   the link is asserted by the authority rather than inferred by us. It is
//   rare — most registries do not publish a website field — which is exactly
//   why it is worth so much when present.
//
//   THE LICENCE NUMBER ON THE SITE is next: a fraudster building a lookalike
//   booking page has to also publish a real registration that resolves to the
//   real property, which defeats the point of the fraud.
//
//   NAME AND ADDRESS MATCHES are weak individually — a scam site copies both
//   trivially — and are weighted accordingly. They corroborate; they do not
//   establish.
//
//   DOMAIN AGE and TLS are weakest. TLS is free and universal in 2026, so its
//   presence proves almost nothing; its ABSENCE is what matters, and that is
//   handled as a trust finding rather than a missing point.
//
// CONTRADICTORY EVIDENCE SUBTRACTS. An address on the site that disagrees with
// the registry is not a neutral absence, it is a reason to doubt, and a scoring
// model that only ever adds cannot express that.
// ---------------------------------------------------------------------------

import type {
  Evidence,
  EvidenceKind,
  TrustFinding,
  VerificationStatus,
} from "./types";

/** Points per evidence kind when it SUPPORTS the identity. */
const WEIGHTS: Record<EvidenceKind, number> = {
  registry_match: 35,
  registry_status_active: 10,
  domain_in_registry: 25,
  license_on_site: 15,
  structured_data: 6,
  booking_engine_detected: 5,
  name_match_on_site: 5,
  address_match_on_site: 5,
  phone_match_on_site: 4,
  domain_age: 3,
  tls_valid: 2,
};

/**
 * Penalty when the same evidence kind CONTRADICTS.
 *
 * Larger than the reward in every case. Finding the wrong address on a site
 * claiming to be a property is more informative than finding the right one:
 * the right one is what a copy-paste fraud produces too.
 */
const CONTRADICTION_PENALTY: Partial<Record<EvidenceKind, number>> = {
  registry_match: 40,
  registry_status_active: 25,
  license_on_site: 30,
  name_match_on_site: 15,
  address_match_on_site: 20,
  phone_match_on_site: 10,
  domain_in_registry: 35,
};

const SEVERITY_PENALTY = { info: 0, warning: 8, critical: 25 } as const;

export interface ConfidenceResult {
  /** 0-100. */
  score: number;
  status: VerificationStatus;
  /** Every contribution, so the number can be explained rather than asserted. */
  breakdown: { label: string; points: number }[];
  /** What would raise the score most, for the UI to suggest. */
  missing: EvidenceKind[];
}

/**
 * Score a property from its evidence.
 *
 * Deliberately a pure function with no I/O: the same evidence must always
 * produce the same number, in any process, so a score shown to a user can be
 * reproduced by anyone holding the same record.
 */
export function scoreConfidence(evidence: Evidence[], findings: TrustFinding[]): ConfidenceResult {
  const breakdown: { label: string; points: number }[] = [];
  let raw = 0;

  // De-duplicate by kind: two sources both confirming the name is one name
  // match, not two. Without this, a page that repeats its own address three
  // times would score higher than a registry hit.
  const strongest = new Map<EvidenceKind, Evidence>();
  for (const e of evidence) {
    const held = strongest.get(e.kind);
    // A contradiction always wins over a confirmation of the same kind —
    // if one source says the address disagrees, that is the finding.
    if (!held || (held.supports && !e.supports)) strongest.set(e.kind, e);
  }

  for (const [kind, e] of strongest) {
    if (e.supports) {
      const points = WEIGHTS[kind] ?? 0;
      if (points === 0) continue;
      raw += points;
      breakdown.push({ label: `${labelFor(kind)} (${e.source})`, points });
    } else {
      const penalty = CONTRADICTION_PENALTY[kind] ?? 10;
      raw -= penalty;
      breakdown.push({ label: `${labelFor(kind)} conflicts (${e.source})`, points: -penalty });
    }
  }

  for (const finding of findings) {
    const penalty = SEVERITY_PENALTY[finding.severity];
    if (penalty === 0) continue;
    raw -= penalty;
    breakdown.push({ label: finding.detail, points: -penalty });
  }

  const score = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    score,
    status: statusFor(strongest, findings, score),
    breakdown,
    missing: (Object.keys(WEIGHTS) as EvidenceKind[]).filter((k) => !strongest.has(k)),
  };
}

/**
 * The status.
 *
 * Not a threshold on the score. A number can be pushed over a line by an
 * accumulation of weak signals, and "VERIFIED" should mean something specific:
 * a registry confirmed the property AND we found a site we can tie to it. That
 * is a structural claim, so it is decided structurally.
 */
function statusFor(
  evidence: Map<EvidenceKind, Evidence>,
  findings: TrustFinding[],
  score: number
): VerificationStatus {
  const supports = (kind: EvidenceKind) => evidence.get(kind)?.supports === true;
  const contradicts = (kind: EvidenceKind) => evidence.get(kind)?.supports === false;

  // A critical trust finding caps the result regardless of what else was
  // collected. An active registration does not make a mismatched address fine.
  if (findings.some((f) => f.severity === "critical")) return "PARTIALLY_VERIFIED";

  // The registry actively said no. That is the one case that is genuinely
  // NOT_FOUND rather than merely unconfirmed.
  if (contradicts("registry_match")) return "NOT_FOUND";

  const registryConfirmed = supports("registry_match");
  const siteTied = supports("domain_in_registry") || supports("license_on_site");

  if (registryConfirmed && siteTied && score >= 60) return "VERIFIED";
  if (registryConfirmed || siteTied) return "PARTIALLY_VERIFIED";
  // Corroborating detail without an authoritative anchor.
  if (score > 0) return "UNVERIFIED";
  return "NOT_FOUND";
}

function labelFor(kind: EvidenceKind): string {
  switch (kind) {
    case "registry_match":
      return "Government registry match";
    case "registry_status_active":
      return "Registration active";
    case "domain_in_registry":
      return "Website listed in registry";
    case "license_on_site":
      return "Licence number on website";
    case "name_match_on_site":
      return "Name matches website";
    case "address_match_on_site":
      return "Address matches website";
    case "phone_match_on_site":
      return "Phone matches website";
    case "booking_engine_detected":
      return "Booking engine detected";
    case "structured_data":
      return "Structured property data";
    case "tls_valid":
      return "Valid TLS certificate";
    case "domain_age":
      return "Established domain";
  }
}

/**
 * What a reader should be told about this score.
 *
 * The wording matters more than the number. "96%" invites a booking decision;
 * "registry confirmed, website tied to it" tells someone what was actually
 * checked, and is the thing they can act on.
 */
export function explainStatus(status: VerificationStatus): string {
  switch (status) {
    case "VERIFIED":
      return "A government registry confirms this property, and we tied its official website to that record.";
    case "PARTIALLY_VERIFIED":
      return "Some of this property's identity is confirmed, but not the full chain from registry to website.";
    case "UNVERIFIED":
      return "We found supporting detail but no authoritative record. Most countries have no public short-term-rental registry, so this is common and is not a warning about the property.";
    case "NOT_FOUND":
      return "We could not match this property to any record we can check. That is not evidence of a problem — only that we cannot confirm it.";
  }
}
