// ---------------------------------------------------------------------------
// Compliance & Risk overview — server-only aggregation.
//
// Every figure here comes from a durable record or a real configuration fact.
// Where no durable source exists the value is null and the UI says "Not
// available" — never a placeholder number. Health is derived from an explicit
// formula over these facts (complianceHealth), not asserted.
//
// Sources:
//   users / verified users   Supabase `users` (sbCount) — null without SUPABASE_URL
//   business onboarding      settlement_onboarding states (listStates)
//   screening / alerts       the screening result stored on each onboarding case
//   providers                env configuration of the existing adapters
// ---------------------------------------------------------------------------

import type { OnboardingState } from "@/lib/settlement/onboarding";

export type CapabilityStatus = "live" | "configured" | "not_configured" | "not_available";

export type Capability = {
  id: string;
  module: string;
  label: string;
  status: CapabilityStatus;
  /** Which adapter or rule set serves it, when one does. */
  provider: string | null;
  /** What is true today, in one sentence. */
  detail: string;
  /** What would make it available, when it is not. */
  requires?: string;
};

type Env = Record<string, string | undefined>;

/**
 * The capability registry. "live" = served by code in this repository with no
 * external dependency; "configured" = an external adapter exists and its
 * credentials are present; "not_configured" = an adapter exists but has no
 * credentials; "not_available" = no adapter exists in this repository.
 */
export function capabilities(env: Env = process.env): Capability[] {
  const persona = Boolean(env.PERSONA_API_KEY);
  const sumsub = Boolean(env.SUMSUB_APP_TOKEN && env.SUMSUB_SECRET_KEY);
  const identityName = env.COMPLIANCE_IDENTITY_PROVIDER || "persona";
  const identity = identityName === "sumsub" ? sumsub : persona;
  const complyAdvantage = Boolean(env.COMPLYADVANTAGE_API_KEY);
  const circle = Boolean(env.CIRCLE_COMPLIANCE_API_KEY);
  return [
    {
      id: "kyc",
      module: "kyc",
      label: "Identity verification (KYC)",
      status: identity ? "configured" : "not_configured",
      provider: identityName === "sumsub" ? "Sumsub" : "Persona",
      detail: identity
        ? "Document, selfie and liveness checks run in the provider; results apply only through signed webhooks bound to the inquiry FurlPay created."
        : "No identity provider credentials on this deployment. No applicant can be verified; activation stays blocked.",
      requires: identity ? undefined : identityName === "sumsub" ? "SUMSUB_APP_TOKEN and SUMSUB_SECRET_KEY" : "PERSONA_API_KEY (and PERSONA_WEBHOOK_SECRET)",
    },
    {
      id: "sanctions",
      module: "aml",
      label: "Sanctions screening (names)",
      status: complyAdvantage ? "configured" : "live",
      provider: complyAdvantage ? "ComplyAdvantage + OFAC SDN" : "FurlPay OFAC SDN matcher",
      detail: complyAdvantage
        ? "ComplyAdvantage screening with the local OFAC SDN list as the floor."
        : "Names are screened against the OFAC SDN list locally. Potential matches go to human review.",
    },
    {
      id: "pep",
      module: "aml",
      label: "PEP & adverse media",
      status: complyAdvantage ? "configured" : "not_configured",
      provider: complyAdvantage ? "ComplyAdvantage" : null,
      detail: complyAdvantage ? "PEP and adverse-media screening via ComplyAdvantage." : "The OFAC list has no PEP or adverse-media data. Not screened on this deployment.",
      requires: complyAdvantage ? undefined : "COMPLYADVANTAGE_API_KEY",
    },
    {
      id: "wallet",
      module: "travel",
      label: "Wallet address screening",
      status: circle ? "configured" : "live",
      provider: circle ? "OFAC SDN + Circle Compliance Engine" : "OFAC SDN (addresses)",
      detail: circle
        ? "Addresses are screened against OFAC and Circle; the stricter verdict wins and a Circle error blocks."
        : "Addresses are screened against OFAC-listed digital currency addresses. No exposure analytics (mixers, hacks) without a blockchain-intelligence provider.",
    },
    {
      id: "kyb",
      module: "kyb",
      label: "Business verification (KYB)",
      status: "live",
      provider: "FurlPay onboarding + compliance review",
      detail: "Businesses submit documents and ownership; a compliance officer reviews each case. No automated company-registry lookup.",
      requires: "A registry provider (e.g. a KYB data vendor) for automated lookups",
    },
    {
      id: "country",
      module: "policies",
      label: "Country risk (FATF lists)",
      status: "live",
      provider: "FurlPay rule engine",
      detail: "FATF black and grey lists drive country risk and required checks.",
    },
    {
      id: "fraud",
      module: "fraud",
      label: "Fraud & device intelligence",
      status: "not_available",
      provider: null,
      detail: "No device-intelligence or fraud-scoring adapter exists in this repository.",
      requires: "A fraud/device intelligence provider and a rules engine",
    },
    {
      id: "monitoring",
      module: "monitoring",
      label: "Transaction monitoring",
      status: "not_available",
      provider: null,
      detail: "No transaction-monitoring scenarios run. Payments are screened at the counterparty, not monitored for patterns.",
      requires: "Monitoring rules over the payment ledger",
    },
    {
      id: "travel_rule",
      module: "travel",
      label: "Travel Rule messaging",
      status: "not_available",
      provider: null,
      detail: "A threshold check exists (/api/compliance/travel-rule); no VASP-to-VASP messaging provider is wired here.",
      requires: "A Travel Rule network adapter (e.g. Notabene/TRUST) with credentials",
    },
    {
      id: "india",
      module: "india",
      label: "Aadhaar & India eKYC",
      status: "not_available",
      provider: null,
      detail: "No DigiLocker, offline-eKYC or Aadhaar authentication integration. Aadhaar flows need a UIDAI-authorised partner (AUA/KUA) and FurlPay's legal role confirmed first.",
      requires: "UIDAI authorisation via a certified partner, consent and data-handling approval",
    },
  ];
}

export type OnboardingSummary = {
  cases: number;
  submitted: number;
  pendingReview: number;
  changesRequested: number;
  approved: number;
  rejected: number;
  active: number;
  screening: { notRun: number; clear: number; potentialMatch: number; clearedByReview: number; confirmedMatch: number; failed: number };
  documentsAwaitingReview: number;
  /** Open items an officer must act on: pending reviews + unresolved potential matches. */
  openAlerts: number;
};

export function summarizeOnboarding(states: readonly OnboardingState[]): OnboardingSummary {
  const s: OnboardingSummary = {
    cases: states.length,
    submitted: 0,
    pendingReview: 0,
    changesRequested: 0,
    approved: 0,
    rejected: 0,
    active: 0,
    screening: { notRun: 0, clear: 0, potentialMatch: 0, clearedByReview: 0, confirmedMatch: 0, failed: 0 },
    documentsAwaitingReview: 0,
    openAlerts: 0,
  };
  for (const st of states) {
    const r = st.review?.status ?? "not_submitted";
    if (r !== "not_submitted") s.submitted++;
    if (r === "pending") s.pendingReview++;
    if (r === "changes_requested") s.changesRequested++;
    if (r === "approved") s.approved++;
    if (r === "rejected") s.rejected++;
    if (st.activation.status === "ACTIVE") s.active++;
    switch (st.screening?.status) {
      case undefined:
        s.screening.notRun++;
        break;
      case "clear":
        s.screening.clear++;
        break;
      case "potential_match":
        s.screening.potentialMatch++;
        break;
      case "cleared_by_review":
        s.screening.clearedByReview++;
        break;
      case "confirmed_match":
        s.screening.confirmedMatch++;
        break;
      case "failed":
        s.screening.failed++;
        break;
    }
    s.documentsAwaitingReview += st.documents.filter((d) => d.review === "received").length;
  }
  s.openAlerts = s.pendingReview + s.screening.potentialMatch;
  return s;
}

export type HealthLevel = "operational" | "degraded" | "attention" | "unavailable";
export type Health = { level: HealthLevel; score: number; reasons: string[] };

/**
 * Compliance health, from an explicit formula (documented so it can be audited):
 *   start at 100;
 *   −40 if identity verification is not configured (no one can be verified);
 *   −10 for each other external capability that is not configured/available (max −30);
 *   −15 if any screening run failed (the service is unreachable for some cases);
 *   −5 per unresolved potential sanctions match (max −20);
 *   −2 per case awaiting review (max −10).
 *   level: ≥85 operational, ≥60 degraded, ≥30 attention, else unavailable.
 */
export function complianceHealth(caps: readonly Capability[], summary: OnboardingSummary | null): Health {
  let score = 100;
  const reasons: string[] = [];
  const kyc = caps.find((c) => c.id === "kyc");
  if (kyc && kyc.status !== "configured" && kyc.status !== "live") {
    score -= 40;
    reasons.push("Identity verification is not configured.");
  }
  const missing = caps.filter((c) => c.id !== "kyc" && (c.status === "not_configured" || c.status === "not_available"));
  if (missing.length) {
    score -= Math.min(30, missing.length * 10);
    reasons.push(`${missing.length} capabilit${missing.length === 1 ? "y is" : "ies are"} not available: ${missing.map((c) => c.label).join(", ")}.`);
  }
  if (summary) {
    if (summary.screening.failed) {
      score -= 15;
      reasons.push(`${summary.screening.failed} screening run${summary.screening.failed === 1 ? "" : "s"} failed.`);
    }
    if (summary.screening.potentialMatch) {
      score -= Math.min(20, summary.screening.potentialMatch * 5);
      reasons.push(`${summary.screening.potentialMatch} potential sanctions match${summary.screening.potentialMatch === 1 ? "" : "es"} awaiting review.`);
    }
    if (summary.pendingReview) {
      score -= Math.min(10, summary.pendingReview * 2);
      reasons.push(`${summary.pendingReview} case${summary.pendingReview === 1 ? "" : "s"} awaiting review.`);
    }
  } else {
    reasons.push("Onboarding records are unavailable.");
  }
  score = Math.max(0, score);
  const level: HealthLevel = score >= 85 ? "operational" : score >= 60 ? "degraded" : score >= 30 ? "attention" : "unavailable";
  return { level, score, reasons };
}
