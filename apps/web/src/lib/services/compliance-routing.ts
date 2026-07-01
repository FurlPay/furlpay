import { Stablecoin } from "../types";

// ---------------------------------------------------------------------------
// Dynamic MiCA compliance routing (Playbook Gap 4).
// If a user is in the EEA, inbound MiCA-non-compliant stablecoins (e.g. USDT)
// are auto-swapped to compliant E-money tokens (EURC / USDC) via gasless swap.
// ---------------------------------------------------------------------------

const MICA_COMPLIANT: Set<Stablecoin> = new Set(["USDC", "EURC"]);

export interface RoutingDecision {
  original: Stablecoin;
  routed: Stablecoin;
  autoSwapped: boolean;
  reason: string;
}

export function routeInboundDeposit(
  token: Stablecoin,
  region: "EEA" | "US" | "IN" | "GLOBAL"
): RoutingDecision {
  if (region === "EEA" && !MICA_COMPLIANT.has(token)) {
    const routed: Stablecoin = "EURC";
    return {
      original: token,
      routed,
      autoSwapped: true,
      reason: `MiCA: ${token} not permitted for EEA users — gaslessly swapped to ${routed}`,
    };
  }
  return {
    original: token,
    routed: token,
    autoSwapped: false,
    reason: "Token permitted in user's region",
  };
}
