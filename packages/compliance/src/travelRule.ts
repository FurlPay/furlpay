import { TravelRulePayload } from "./types";

// ---------------------------------------------------------------------------
// Step 3 — FATF Travel Rule enforcement.
// LIVE: Notabene / TRUST Network. Transactions over the threshold must carry
//       originator + beneficiary identity metadata between VASPs.
// ---------------------------------------------------------------------------

const THRESHOLD_USD = 1000;
// India PMLA threshold is ₹50,000 (roughly $600 USD), lower than the FATF $1000 baseline
const INDIA_THRESHOLD_INR = 50000;

export interface TravelRuleInput {
  amountUsd: number;
  amountInr?: number; // Added for India PMLA check
  originator: { name: string; accountId: string; address?: string; pan?: string; registeredAddress?: string }; // Added PAN and registeredAddress for India
  beneficiary: { name: string; accountId: string; vasp?: string };
  provider?: "notabene" | "trust";
  isIndiaTx?: boolean;
}

export function applyTravelRule(input: TravelRuleInput): TravelRulePayload {
  const provider = input.provider ?? "notabene";
  
  const thresholdMet = input.isIndiaTx 
    ? (input.amountInr !== undefined && input.amountInr >= INDIA_THRESHOLD_INR)
    : (input.amountUsd >= THRESHOLD_USD);

  if (!thresholdMet) {
    return { required: false, threshold: input.isIndiaTx ? INDIA_THRESHOLD_INR : THRESHOLD_USD, provider, status: "not_required" };
  }

  const counterpartyKnown = !!input.beneficiary.vasp;
  return {
    required: true,
    threshold: input.isIndiaTx ? INDIA_THRESHOLD_INR : THRESHOLD_USD,
    provider,
    originator: input.originator,
    beneficiary: input.beneficiary,
    status: counterpartyKnown ? "attached" : "pending_counterparty",
  };
}
