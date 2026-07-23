// ---------------------------------------------------------------------------
// Country-based compliance rule engine.
//
// Maps ISO 3166-1 alpha-2 country codes to required documents, checks,
// transaction limits, and Enhanced Due Diligence (EDD) requirements.
// Uses FATF black/grey lists for automatic risk classification.
// ---------------------------------------------------------------------------

import { getCountryFATFStatus, getCountryRiskLevel, BLACK_LIST } from "./fatfLists";
import type { DocType, CheckType, RiskLevel } from "./providers/types";

export interface CountryRule {
  country: string;
  fatfStatus: "black" | "grey" | "clear";
  requiredDocs: DocType[];
  requiredChecks: CheckType[];
  eddRequired: boolean;
  autoBlock: boolean;
  maxTransactionUSD: number;
  notes: string;
}

/** Default rule derived from FATF status. */
function defaultRule(country: string): CountryRule {
  const fatfStatus = getCountryFATFStatus(country);
  if (fatfStatus === "black") {
    return {
      country,
      fatfStatus,
      requiredDocs: [],
      requiredChecks: [],
      eddRequired: true,
      autoBlock: true,
      maxTransactionUSD: 0,
      notes: "FATF Black List — auto-blocked, countermeasures required",
    };
  }
  if (fatfStatus === "grey") {
    return {
      country,
      fatfStatus,
      requiredDocs: ["PASSPORT", "NATIONAL_ID"],
      requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML", "SANCTIONS", "PEP", "SOURCE_OF_FUNDS"],
      eddRequired: true,
      autoBlock: false,
      maxTransactionUSD: 5000,
      notes: "FATF Grey List — Enhanced Due Diligence required",
    };
  }
  return {
    country,
    fatfStatus: "clear",
    requiredDocs: ["PASSPORT"],
    requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML"],
    eddRequired: false,
    autoBlock: false,
    maxTransactionUSD: 50000,
    notes: "Standard verification",
  };
}

/** Country-specific overrides for major markets. */
const COUNTRY_OVERRIDES = new Map<string, Partial<CountryRule>>([
  ["US", {
    requiredDocs: ["PASSPORT", "DRIVERS_LICENSE"],
    requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML", "SANCTIONS"],
    maxTransactionUSD: 50000,
    notes: "GENIUS Act + BSA + OFAC",
  }],
  ["IN", {
    requiredDocs: ["PAN", "PASSPORT"],
    requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML"],
    maxTransactionUSD: 10000,
    notes: "PMLA + FIU-IND",
  }],
  ["GB", {
    requiredDocs: ["PASSPORT", "DRIVERS_LICENSE"],
    requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML", "SANCTIONS", "PEP"],
    maxTransactionUSD: 25000,
    notes: "FCA MLR 2017 + Financial Promotions",
  }],
  ["DE", {
    requiredDocs: ["PASSPORT", "NATIONAL_ID"],
    requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML", "PEP"],
    maxTransactionUSD: 25000,
    notes: "MiCA + AMLD",
  }],
  ["SG", {
    requiredDocs: ["PASSPORT", "NATIONAL_ID"],
    requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML", "SANCTIONS"],
    maxTransactionUSD: 30000,
    notes: "MAS PSA 2019",
  }],
  ["AE", {
    requiredDocs: ["PASSPORT", "RESIDENCE_PERMIT"],
    requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML", "SANCTIONS", "PEP"],
    maxTransactionUSD: 20000,
    notes: "CBUAE + VARA",
  }],
  ["JP", {
    requiredDocs: ["PASSPORT", "NATIONAL_ID"],
    requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML"],
    maxTransactionUSD: 30000,
    notes: "JFSA + PSA",
  }],
  ["AU", {
    requiredDocs: ["PASSPORT", "DRIVERS_LICENSE"],
    requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML", "SANCTIONS"],
    maxTransactionUSD: 30000,
    notes: "AUSTRAC AML/CTF Act",
  }],
  ["BR", {
    requiredDocs: ["PASSPORT", "NATIONAL_ID"],
    requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML"],
    maxTransactionUSD: 15000,
    notes: "COAF + BCB",
  }],
  ["NG", {
    requiredDocs: ["PASSPORT", "NATIONAL_ID"],
    requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML", "SANCTIONS"],
    maxTransactionUSD: 10000,
    notes: "CBN AML/CFT + NFIU",
  }],
  ["KE", {
    requiredDocs: ["PASSPORT", "NATIONAL_ID"],
    requiredChecks: ["GOV_ID", "FACE", "LIVENESS", "AML", "SANCTIONS"],
    maxTransactionUSD: 10000,
    notes: "CBK POCAMLA — FATF Grey List, EDD required",
  }],
]);

/** Get the compliance rule for a country code. */
export function getCountryRule(country: string): CountryRule {
  const code = country.trim().toUpperCase();
  const base = defaultRule(code);

  // Apply country-specific overrides if available
  const override = COUNTRY_OVERRIDES.get(code);
  if (override) {
    return { ...base, ...override, country: code };
  }

  return base;
}

/** Evaluate whether a transaction is allowed for a country + amount. */
export function evaluateRisk(
  country: string,
  transactionUSD: number,
): { allowed: boolean; riskLevel: RiskLevel; rule: CountryRule; reason: string } {
  const rule = getCountryRule(country);

  if (rule.autoBlock) {
    return {
      allowed: false,
      riskLevel: "critical",
      rule,
      reason: `Blocked: ${country} is on the FATF Black List`,
    };
  }

  if (transactionUSD > rule.maxTransactionUSD) {
    return {
      allowed: false,
      riskLevel: "high",
      rule,
      reason: `Transaction $${transactionUSD} exceeds ${country} limit of $${rule.maxTransactionUSD}`,
    };
  }

  const riskLevel = getCountryRiskLevel(country);
  return {
    allowed: true,
    riskLevel,
    rule,
    reason: rule.eddRequired
      ? `Allowed with Enhanced Due Diligence (${rule.notes})`
      : `Allowed (${rule.notes})`,
  };
}
