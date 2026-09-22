// ---------------------------------------------------------------------------
// India CDD — Customer Due Diligence per FIU-IND 2026 guidelines.
//
// Every reporting entity registered with FIU-IND must collect and verify:
// - PAN (Permanent Account Number) for transactions > ₹50,000
// - OVD (Officially Valid Document): Aadhaar, Passport, Voter ID, DL
// - CKYC number from the Central KYC Registry
//
// Enhanced Due Diligence (EDD) triggers:
// - Unhosted/self-hosted wallets
// - Mixer/tumbler interaction detected
// - High-risk jurisdiction (FATF grey/black list)
// - Single transactions > ₹10,00,000 (₹10 lakh)
// - Politically Exposed Persons (PEPs)
// ---------------------------------------------------------------------------

export type OvdType = "aadhaar" | "passport" | "voter_id" | "driving_license";

export interface IndiaCddInput {
  pan?: string;
  ovdType?: OvdType;
  ovdNumber?: string;
  ckycNumber?: string;
  isUnhostedWallet?: boolean;
  isMixerInteraction?: boolean;
  isPep?: boolean;
  jurisdiction?: string;
}

export interface IndiaCddResult {
  compliant: boolean;
  missingDocuments: string[];
  eddRequired: boolean;
  eddTriggers: string[];
  panValid: boolean | null;
  tier: "basic" | "standard" | "enhanced";
}

// PAN format: ABCDE1234F (5 letters, 4 digits, 1 letter)
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function validatePan(pan: string): boolean {
  return PAN_REGEX.test(pan.toUpperCase());
}

export function validateIndiaCdd(input: IndiaCddInput, txAmountInr: number): IndiaCddResult {
  const missingDocuments: string[] = [];
  const eddTriggers: string[] = [];
  let panValid: boolean | null = null;
  
  if (txAmountInr > 50000) {
    if (!input.pan) {
      missingDocuments.push("PAN");
    } else {
      panValid = validatePan(input.pan);
      if (!panValid) missingDocuments.push("VALID_PAN");
    }
  }

  if (!input.ovdType || !input.ovdNumber) {
    missingDocuments.push("OVD");
  }

  if (input.isUnhostedWallet) eddTriggers.push("unhosted_wallet");
  if (input.isMixerInteraction) eddTriggers.push("mixer_interaction");
  if (input.isPep) eddTriggers.push("pep");
  if (txAmountInr > 1000000) eddTriggers.push("high_value_tx");
  
  // High-risk jurisdiction check could be more robust
  if (input.jurisdiction && ["KP", "IR", "MM"].includes(input.jurisdiction)) {
    eddTriggers.push("high_risk_jurisdiction");
  }

  const eddRequired = eddTriggers.length > 0;
  
  let tier: "basic" | "standard" | "enhanced" = "basic";
  if (eddRequired) {
    tier = "enhanced";
  } else if (input.pan && input.ovdType) {
    tier = "standard";
  }

  const compliant = missingDocuments.length === 0;

  return {
    compliant,
    missingDocuments,
    eddRequired,
    eddTriggers,
    panValid,
    tier
  };
}
