import { AmlScreenResult } from "./types";

// ---------------------------------------------------------------------------
// Step 2 — On-chain AML monitoring.
// LIVE: Chainalysis / TRM Labs — screen source/destination wallet risk on L2.
// MOCK: deterministic scoring; known OFAC addresses always block.
// ---------------------------------------------------------------------------

const OFAC_ADDRESSES = new Set<string>([
  "0x000000000000000000000000000000000000dead",
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  "0x8589427373d6d84e98730d7795d8f6f8731fda16", // Tornado-style (illustrative)
]);

function hash(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n = (n << 5) - n + s.charCodeAt(i);
    n |= 0;
  }
  return Math.abs(n);
}

export function screenWallet(
  address: string,
  provider: "chainalysis" | "trm" = "chainalysis"
): AmlScreenResult {
  const norm = address.trim().toLowerCase();
  const sanctioned = OFAC_ADDRESSES.has(norm);
  const score = sanctioned ? 100 : hash(norm) % 45;

  let risk: AmlScreenResult["risk"] = "low";
  if (score >= 85) risk = "severe";
  else if (score >= 60) risk = "high";
  else if (score >= 35) risk = "medium";

  const categories: string[] = [];
  if (sanctioned) categories.push("sanctions", "ofac");
  else if (score >= 35) categories.push("mixer-exposure");

  let action: AmlScreenResult["action"] = "allow";
  if (sanctioned || risk === "severe") action = "block";
  else if (risk === "high") action = "review";

  return { address, provider, risk, score, sanctioned, categories, action };
}
