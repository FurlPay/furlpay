import { RiskScreenResult } from "../types";

// ---------------------------------------------------------------------------
// Compliance / wallet risk scoring.
// LIVE: Chainalysis + TRM Labs address screening + Persona KYC.
// MOCK: deterministic pseudo-scoring so flows are reproducible in the demo.
// (Blueprint §4.4 + Playbook Gap 1: real-time sanctions/AML screening.)
// ---------------------------------------------------------------------------

const KNOWN_SANCTIONED = new Set<string>([
  "0x000000000000000000000000000000000000dead",
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
]);

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function screenAddress(address: string): RiskScreenResult {
  const normalized = address.trim().toLowerCase();
  const sanctioned = KNOWN_SANCTIONED.has(normalized);
  const score = sanctioned ? 100 : hash(normalized) % 45; // demo: real addrs stay low-risk

  let risk: RiskScreenResult["risk"] = "low";
  if (score >= 85) risk = "severe";
  else if (score >= 60) risk = "high";
  else if (score >= 35) risk = "medium";

  const reasons: string[] = [];
  if (sanctioned) reasons.push("Address on OFAC sanctions list");
  if (score >= 35 && !sanctioned) reasons.push("Exposure to mixer / high-risk counterparties");
  if (reasons.length === 0) reasons.push("No adverse signals");

  return { address, risk, score, sanctioned, reasons };
}
