import { TravelRulePayload } from "./types";

// ---------------------------------------------------------------------------
// Step 3 — FATF Travel Rule enforcement.
// LIVE: Notabene / TRUST Network. Transactions over the threshold must carry
//       originator + beneficiary identity metadata between VASPs.
// ---------------------------------------------------------------------------

const THRESHOLD_USD = 1000;

export interface TravelRuleInput {
  amountUsd: number;
  originator: { name: string; accountId: string; address?: string };
  beneficiary: { name: string; accountId: string; vasp?: string };
  provider?: "notabene" | "trust";
}

export function applyTravelRule(input: TravelRuleInput): TravelRulePayload {
  const provider = input.provider ?? "notabene";
  if (input.amountUsd < THRESHOLD_USD) {
    return { required: false, threshold: THRESHOLD_USD, provider, status: "not_required" };
  }

  const counterpartyKnown = !!input.beneficiary.vasp;
  return {
    required: true,
    threshold: THRESHOLD_USD,
    provider,
    originator: input.originator,
    beneficiary: input.beneficiary,
    status: counterpartyKnown ? "attached" : "pending_counterparty",
  };
}
