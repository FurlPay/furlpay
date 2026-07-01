import { Region, Stablecoin } from "./types";
import { evaluateStablecoin } from "./stablecoinPolicy";
import { promotionPolicy } from "./promotions";

// ---------------------------------------------------------------------------
// Jurisdiction resolver. EU/UK frameworks apply based on ACTIVITY (who you
// serve), not just where you are hosted - so we resolve from KYC region first,
// then country/IP. The regime drives stablecoin routing (MiCA/GENIUS),
// promotions (FCA), and which licensed entity/rails handle the flow.
// ---------------------------------------------------------------------------

// EEA member states (ISO-3166 alpha-2).
const EEA = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV",
  "LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO",
]);

export function regionForCountry(country?: string): Region {
  if (!country) return "GLOBAL";
  const c = country.trim().toUpperCase();
  if (c === "US") return "US";
  if (c === "GB" || c === "UK") return "UK";
  if (c === "IN") return "IN";
  if (EEA.has(c)) return "EEA";
  return "GLOBAL";
}

export interface JurisdictionInput {
  kycRegion?: Region;
  country?: string; // from KYC address
  ipCountry?: string; // from geo-IP
}

export interface JurisdictionResult {
  regime: Region;
  source: "kyc" | "country" | "ip" | "default";
  frameworks: string[];
  reason: string;
}

const FRAMEWORKS: Record<Region, string[]> = {
  US: ["GENIUS Act", "Bank Secrecy Act", "OFAC", "FATF Travel Rule"],
  EEA: ["MiCA", "AMLD", "FATF Travel Rule"],
  UK: ["FCA Financial Promotions", "MLR 2017", "FATF Travel Rule"],
  IN: ["PMLA", "FIU-IND", "FATF Travel Rule"],
  GLOBAL: ["FATF Travel Rule"],
};

/** Resolve the governing regime. Most-authoritative signal wins: KYC > country > IP. */
export function resolveJurisdiction(input: JurisdictionInput): JurisdictionResult {
  let regime: Region;
  let source: JurisdictionResult["source"];

  if (input.kycRegion) {
    regime = input.kycRegion;
    source = "kyc";
  } else if (input.country) {
    regime = regionForCountry(input.country);
    source = "country";
  } else if (input.ipCountry) {
    regime = regionForCountry(input.ipCountry);
    source = "ip";
  } else {
    regime = "GLOBAL";
    source = "default";
  }

  return {
    regime,
    source,
    frameworks: FRAMEWORKS[regime],
    reason: `Governed by ${regime} rules (resolved from ${source})`,
  };
}

export interface JurisdictionPolicy extends JurisdictionResult {
  stablecoin: ReturnType<typeof evaluateStablecoin> | null;
  promotions: ReturnType<typeof promotionPolicy>;
  settlementRail: string;
}

const RAILS: Record<Region, string> = {
  US: "FedNow / RTP + Cross River (BaaS)",
  EEA: "SEPA Instant + Wise/Swan (EMI)",
  UK: "Faster Payments (FCA EMI)",
  IN: "UPI (partner bank)",
  GLOBAL: "SWIFT",
};

/** Full per-region policy: regime + stablecoin routing + promotions + rail. */
export function jurisdictionPolicy(input: JurisdictionInput, token?: Stablecoin): JurisdictionPolicy {
  const base = resolveJurisdiction(input);
  return {
    ...base,
    stablecoin: token ? evaluateStablecoin(token, base.regime) : null,
    promotions: promotionPolicy(base.regime),
    settlementRail: RAILS[base.regime],
  };
}
