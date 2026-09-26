// AddressCheck — the last thing between a user and an irreversible transfer.
//
// The cases that matter are the ones where the address LOOKS right: a poisoned
// lookalike whose visible characters match, a token contract sitting next to
// the token name in every explorer, a Solana key pasted into an EVM field.

import { describe, it, expect } from "vitest";
import {
  looksLikePoisoning,
  RISK_FLAGS,
  verifyDestinationAddress,
} from "@/lib/security/addressCheck";

const REAL_EVM = "0x7045e4F6C1b5eDf8B0c6B9D3D6Be9E4E1FAAa31e";
const REAL_SOL = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";

describe("valid addresses pass", () => {
  it("accepts a checksummed EVM address on every EVM chain", () => {
    for (const chain of ["base", "arbitrum", "ethereum"] as const) {
      const r = verifyDestinationAddress(REAL_EVM, chain);
      expect(r.isValid).toBe(true);
      expect(r.riskLevel).toBe("clean");
      expect(r.riskFlags).toEqual([]);
    }
  });

  it("accepts a valid Solana address", () => {
    const r = verifyDestinationAddress(REAL_SOL, "solana");
    expect(r.isValid).toBe(true);
    expect(r.riskLevel).toBe("clean");
  });

  it("normalizes a lowercased EVM address to EIP-55 without flagging it", () => {
    // An all-lowercase address has no checksum to fail — it is what most
    // explorers copy. Flagging it would train users to ignore the warning.
    const r = verifyDestinationAddress(REAL_EVM.toLowerCase(), "base");
    expect(r.isValid).toBe(true);
    expect(r.riskFlags).not.toContain(RISK_FLAGS.BAD_CHECKSUM);
    expect(r.address).toBe(REAL_EVM);
  });

  it("never tells the user an address is safe", () => {
    // No client-side check can establish that, and a UI that says "safe" is
    // worse than one that says nothing.
    const r = verifyDestinationAddress(REAL_EVM, "base");
    expect(r.summary.toLowerCase()).not.toMatch(/\bsafe\b/);
    expect(r.summary).toMatch(/confirm the address/i);
  });
});

describe("format failures", () => {
  it("rejects malformed input as critical", () => {
    for (const bad of ["", "0x", "not-an-address", "0x123", `0x${"z".repeat(40)}`]) {
      const r = verifyDestinationAddress(bad, "base");
      expect(r.isValid).toBe(false);
      expect(r.riskLevel).toBe("critical");
    }
  });

  it("flags a Solana address pasted into an EVM field, and says why", () => {
    // "Invalid address" alone would leave the user re-pasting the same key.
    const r = verifyDestinationAddress(REAL_SOL, "base");
    expect(r.isValid).toBe(false);
    expect(r.riskFlags).toContain(RISK_FLAGS.WRONG_CHAIN_FORMAT);
    expect(r.summary).toMatch(/Solana address/i);
    expect(r.summary).toMatch(/would be lost/i);
  });

  it("flags a mixed-case EVM address that fails its checksum", () => {
    // Mixed case means a checksum was present; failing it means a character
    // changed after the address was generated — a corrupted or hijacked paste.
    const tampered = REAL_EVM.slice(0, -1) + (REAL_EVM.endsWith("e") ? "F" : "e");
    const r = verifyDestinationAddress(tampered, "base");
    expect(r.riskFlags).toContain(RISK_FLAGS.BAD_CHECKSUM);
    expect(r.riskLevel).toBe("critical");
  });

  it("rejects an EVM address on the Solana chain", () => {
    expect(verifyDestinationAddress(REAL_EVM, "solana").isValid).toBe(false);
  });
});

describe("burn and contract addresses", () => {
  it("flags the EVM zero address as critical", () => {
    const r = verifyDestinationAddress("0x0000000000000000000000000000000000000000", "base");
    expect(r.riskLevel).toBe("critical");
    expect(r.riskFlags).toContain(RISK_FLAGS.BURN_ADDRESS);
    expect(r.summary).toMatch(/destroyed|cannot be recovered/i);
  });

  it("flags the conventional dEaD burn sink", () => {
    const r = verifyDestinationAddress("0x000000000000000000000000000000000000dEaD", "base");
    expect(r.riskFlags).toContain(RISK_FLAGS.BURN_ADDRESS);
  });

  it("flags sending USDC to the USDC contract itself", () => {
    // A real and common loss: the contract address sits beside the token name
    // in every explorer and looks authoritative.
    const r = verifyDestinationAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "base");
    expect(r.riskLevel).toBe("critical");
    expect(r.riskFlags).toContain(RISK_FLAGS.KNOWN_TOKEN_CONTRACT);
    expect(r.summary).toMatch(/token contract, not a wallet/i);
  });

  it("flags the Solana USDC mint too", () => {
    const r = verifyDestinationAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "solana");
    expect(r.riskFlags).toContain(RISK_FLAGS.KNOWN_TOKEN_CONTRACT);
  });
});

describe("address poisoning — the attack this exists for", () => {
  // The attack: the victim receives a dust transfer from an address engineered
  // to share the first and last 4 characters of someone they really pay. Later
  // they copy the WRONG one out of history and the abbreviation matches.
  const legit = "0x7045e4F6C1b5eDf8B0c6B9D3D6Be9E4E1FAAa31e";
  const mimic = "0x704511111111111111111111111111111111a31e"; // same 4+4 edges

  it("detects a lookalike sharing the visible edges", () => {
    const r = looksLikePoisoning(mimic, [legit]);
    expect(r.poisoned).toBe(true);
    expect(r.matched).toBe(legit);
  });

  it("does NOT flag the genuine address the user actually pays", () => {
    // The whole point: an exact match is the address they meant.
    expect(looksLikePoisoning(legit, [legit]).poisoned).toBe(false);
  });

  it("does not flag an unrelated address", () => {
    expect(looksLikePoisoning("0x1111111111111111111111111111111111111111", [legit]).poisoned).toBe(false);
  });

  it("is case-insensitive, since wallets display mixed case", () => {
    expect(looksLikePoisoning(mimic.toUpperCase().replace("0X", "0x"), [legit]).poisoned).toBe(true);
  });

  it("ignores history entries of a different length", () => {
    // Comparing edges across different address lengths is meaningless and
    // would fire on every Solana address in an EVM history.
    expect(looksLikePoisoning(mimic, [REAL_SOL]).poisoned).toBe(false);
  });

  it("surfaces poisoning as CRITICAL through the full check", () => {
    const r = verifyDestinationAddress(mimic, "base", [legit]);
    expect(r.riskLevel).toBe("critical");
    expect(r.riskFlags).toContain(RISK_FLAGS.POSSIBLE_POISON_ATTACK);
    expect(r.details.isPossiblePoisoning).toBe(true);
    expect(r.details.matchedSimilarAddress).toBe(legit);
    expect(r.summary).toMatch(/almost identical/i);
  });

  it("works on Solana addresses too", () => {
    const solLegit = REAL_SOL;
    const solMimic = `${REAL_SOL.slice(0, 4)}${"1".repeat(REAL_SOL.length - 8)}${REAL_SOL.slice(-4)}`;
    expect(looksLikePoisoning(solMimic, [solLegit]).poisoned).toBe(true);
  });

  it("returns clean when there is no history to compare against", () => {
    expect(verifyDestinationAddress(REAL_EVM, "base", []).riskLevel).toBe("clean");
  });
});

describe("self-send", () => {
  it("warns rather than blocks", () => {
    // Not dangerous, just almost never intended — and it burns a fee.
    const r = verifyDestinationAddress(REAL_EVM, "base", [], REAL_EVM);
    expect(r.riskLevel).toBe("warning");
    expect(r.riskFlags).toContain(RISK_FLAGS.SELF_SEND);
  });

  it("matches case-insensitively", () => {
    const r = verifyDestinationAddress(REAL_EVM, "base", [], REAL_EVM.toLowerCase());
    expect(r.riskFlags).toContain(RISK_FLAGS.SELF_SEND);
  });
});

describe("severity ordering", () => {
  it("reports the WORST flag's level when several apply", () => {
    // A self-send warning must never downgrade a poisoning critical.
    const legit = REAL_EVM;
    const mimic = "0x704511111111111111111111111111111111a31e";
    const r = verifyDestinationAddress(mimic, "base", [legit], mimic);
    expect(r.riskLevel).toBe("critical");
    expect(r.riskFlags).toContain(RISK_FLAGS.POSSIBLE_POISON_ATTACK);
    expect(r.riskFlags).toContain(RISK_FLAGS.SELF_SEND);
  });
});

describe("robustness", () => {
  it("never throws on arbitrary input", () => {
    const junk = ["", " ", "0x", "٣٤٥", "🙂".repeat(10), "0".repeat(200), "\n\t"];
    for (const j of junk) {
      for (const chain of ["base", "solana", "arbitrum", "ethereum"] as const) {
        expect(() => verifyDestinationAddress(j, chain)).not.toThrow();
      }
    }
  });

  it("trims surrounding whitespace from a paste", () => {
    const r = verifyDestinationAddress(`  ${REAL_EVM}\n`, "base");
    expect(r.isValid).toBe(true);
    expect(r.address).toBe(REAL_EVM);
  });
});
