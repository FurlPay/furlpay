// Shared compliance domain types (Furlpay Legal & Compliance Roadmap, Doc 3).
// Cross-cutting primitives are re-exported from @furlpay/types.

export type { Region, Stablecoin } from "@furlpay/types";
import type { Region, Stablecoin } from "@furlpay/types";

export interface KycResult {
  status: "approved" | "pending" | "rejected" | "review";
  provider: "persona" | "sumsub";
  inquiryId: string;
  checks: {
    documentValid: boolean;
    faceMatch: boolean;
    pepSanctionsClear: boolean;
    ageOver18: boolean;
  };
  reasons: string[];
  completedInMs: number;
}

export interface AmlScreenResult {
  address: string;
  provider: "chainalysis" | "trm" | "ofac-sdn" | "chainalysis-oracle" | "onchain-registry" | "circle";
  risk: "low" | "medium" | "high" | "severe";
  score: number; // 0-100
  sanctioned: boolean;
  categories: string[];
  action: "allow" | "review" | "block";
}

export interface TravelRulePayload {
  required: boolean;
  threshold: number;
  provider: "notabene" | "trust";
  originator?: {
    name: string;
    accountId: string;
    address?: string;
  };
  beneficiary?: {
    name: string;
    accountId: string;
    vasp?: string;
  };
  status: "attached" | "not_required" | "pending_counterparty";
}

export interface StablecoinPolicy {
  token: Stablecoin;
  allowed: boolean;
  routedTo?: Stablecoin;
  regime: "MiCA" | "GENIUS" | "none";
  reason: string;
}

export interface PromotionPolicy {
  region: Region;
  showRiskWarning: boolean;
  coolingOffHours: number;
  referralBonusAllowed: boolean;
  reason: string;
}
