import { getAddress, isAddress } from "viem";
import { PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// AddressCheck — pre-flight verification of a destination address.
//
// The Web3 equivalent of a bank's account-name check, and it exists because
// crypto has no equivalent of "the name didn't match". A wrong address is a
// final, unrecoverable transfer, so the only place to catch it is BEFORE the
// signature.
//
// WHAT THIS CATCHES, AND WHAT IT CANNOT
// It catches the mistakes that look right: a poisoned lookalike, a burn
// address, a checksum that fails, a Solana key pasted into an EVM field.
//
// It does NOT prove the recipient is who the user thinks. Nothing client-side
// can. A clean result means "no known red flag", never "safe to send", and the
// wording of every flag here is chosen so a UI cannot accidentally promise the
// second thing.
//
// PURE AND SYNCHRONOUS ON PURPOSE. No network call, no oracle. It runs inline
// on the send screen while the user is still typing, and a check that needs a
// round trip is a check that gets skipped when the network is slow — exactly
// when a user is most likely to be somewhere unfamiliar paying someone new.
// Reputation lookups belong in a separate, async layer that can fail without
// blocking the keystroke.
// ---------------------------------------------------------------------------

export type Chain = "base" | "solana" | "arbitrum" | "ethereum";
export type RiskLevel = "clean" | "warning" | "critical";

export const RISK_FLAGS = {
  INVALID_FORMAT: "INVALID_FORMAT",
  WRONG_CHAIN_FORMAT: "WRONG_CHAIN_FORMAT",
  BAD_CHECKSUM: "BAD_CHECKSUM",
  BURN_ADDRESS: "BURN_ADDRESS",
  POSSIBLE_POISON_ATTACK: "POSSIBLE_POISON_ATTACK",
  KNOWN_TOKEN_CONTRACT: "KNOWN_TOKEN_CONTRACT",
  SELF_SEND: "SELF_SEND",
} as const;

export type RiskFlag = (typeof RISK_FLAGS)[keyof typeof RISK_FLAGS];

/**
 * Addresses that consume anything sent to them.
 *
 * The EVM zero address is the classic. 0x…dEaD is the conventional burn sink
 * and receives real value by accident constantly. The Solana entries are the
 * system program and the incinerator.
 */
const BURN_ADDRESSES = new Set(
  [
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dEaD",
    "0xdEAD000000000000000042069420694206942069",
    "11111111111111111111111111111111",
    "1nc1nerator11111111111111111111111111111111",
  ].map((a) => a.toLowerCase())
);

/**
 * Token mints and contracts users paste by mistake.
 *
 * Sending USDC to the USDC contract is a real and common loss: the address is
 * in every block explorer next to the token name, and it looks authoritative.
 */
const KNOWN_CONTRACTS = new Set(
  [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC Base
    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC Arbitrum
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC Ethereum
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC Solana
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT Solana
  ].map((a) => a.toLowerCase())
);

const EVM_CHAINS = new Set<Chain>(["base", "arbitrum", "ethereum"]);

export interface AddressCheckReport {
  /** Echoed back normalized (EIP-55 checksummed for EVM) where possible. */
  address: string;
  chain: Chain;
  isValid: boolean;
  riskLevel: RiskLevel;
  riskFlags: RiskFlag[];
  details: {
    isChecksummed?: boolean;
    isBurnAddress?: boolean;
    isKnownContract?: boolean;
    isPossiblePoisoning?: boolean;
    /** The address from history the candidate is mimicking. */
    matchedSimilarAddress?: string;
  };
  /** One sentence a UI can show verbatim. Never says "safe". */
  summary: string;
}

/**
 * How many leading and trailing characters a poisoning attack matches.
 *
 * Wallets abbreviate as `0x1234…abcd`, so an attacker generates a vanity
 * address sharing exactly those visible characters. Four each side is the
 * shape of the attack because four each side is what wallets display.
 */
const POISON_EDGE_LEN = 4;

/**
 * Detect an address-poisoning lookalike.
 *
 * The attack: the victim receives a dust or zero-value transfer from an
 * address engineered to share the first and last few characters of someone
 * they really pay. Later they copy the WRONG one out of their history, glance
 * at the abbreviation, and it matches.
 *
 * So the test is deliberately: same visible edges, DIFFERENT middle. An exact
 * match is not poisoning — it is the address they meant.
 */
export function looksLikePoisoning(
  candidate: string,
  history: readonly string[]
): { poisoned: boolean; matched?: string } {
  const c = candidate.toLowerCase();

  for (const raw of history) {
    const h = raw.toLowerCase();
    if (h === c) return { poisoned: false }; // the real one
    // Comparing edges across different lengths is meaningless.
    if (h.length !== c.length) continue;
    if (c.length < POISON_EDGE_LEN * 2 + 1) continue;

    const headMatch = c.slice(0, POISON_EDGE_LEN) === h.slice(0, POISON_EDGE_LEN);
    const tailMatch = c.slice(-POISON_EDGE_LEN) === h.slice(-POISON_EDGE_LEN);
    if (headMatch && tailMatch) return { poisoned: true, matched: raw };
  }
  return { poisoned: false };
}

function worst(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = { clean: 0, warning: 1, critical: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Screen a destination address.
 *
 * `historyHint` is the user's own recent recipients. It never leaves the
 * caller — the comparison is local — which matters because a list of who
 * someone pays is exactly the sort of thing that should not be posted to a
 * screening service to find out whether it is safe to pay them.
 */
export function verifyDestinationAddress(
  address: string,
  chain: Chain,
  historyHint: readonly string[] = [],
  selfAddress?: string
): AddressCheckReport {
  const trimmed = address.trim();
  const flags: RiskFlag[] = [];
  let level: RiskLevel = "clean";
  const details: AddressCheckReport["details"] = {};

  const isEvmChain = EVM_CHAINS.has(chain);
  let normalized = trimmed;
  let valid = false;

  if (isEvmChain) {
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed) && !trimmed.startsWith("0x")) {
      // A base58 key in an EVM field. Sending here is an immediate, total
      // loss, and "invalid address" alone would not tell the user why.
      flags.push(RISK_FLAGS.WRONG_CHAIN_FORMAT);
      return {
        address: trimmed,
        chain,
        isValid: false,
        riskLevel: "critical",
        riskFlags: flags,
        details,
        summary: `That looks like a Solana address, but you're sending on ${chain}. Funds sent here would be lost.`,
      };
    }
    if (isAddress(trimmed, { strict: false })) {
      valid = true;
      normalized = getAddress(trimmed);
      // Mixed case that fails EIP-55 means a character was altered after the
      // address was generated — a corrupted paste or a tampered clipboard.
      const hasMixedCase = /[a-f]/.test(trimmed.slice(2)) && /[A-F]/.test(trimmed.slice(2));
      details.isChecksummed = hasMixedCase && trimmed === normalized;
      if (hasMixedCase && trimmed !== normalized) {
        flags.push(RISK_FLAGS.BAD_CHECKSUM);
        level = worst(level, "critical");
      }
    }
  } else {
    try {
      const pk = new PublicKey(trimmed);
      normalized = pk.toBase58();
      valid = normalized === trimmed;
      if (!valid) flags.push(RISK_FLAGS.INVALID_FORMAT);
    } catch {
      valid = false;
    }
  }

  if (!valid && flags.length === 0) flags.push(RISK_FLAGS.INVALID_FORMAT);
  if (!valid) {
    return {
      address: trimmed,
      chain,
      isValid: false,
      riskLevel: "critical",
      riskFlags: flags,
      details,
      summary: `That is not a valid ${chain} address.`,
    };
  }

  const lower = normalized.toLowerCase();

  if (BURN_ADDRESSES.has(lower)) {
    flags.push(RISK_FLAGS.BURN_ADDRESS);
    level = worst(level, "critical");
    details.isBurnAddress = true;
  }

  if (KNOWN_CONTRACTS.has(lower)) {
    flags.push(RISK_FLAGS.KNOWN_TOKEN_CONTRACT);
    level = worst(level, "critical");
    details.isKnownContract = true;
  }

  if (selfAddress && selfAddress.trim().toLowerCase() === lower) {
    // Not dangerous, just almost never intended — and it burns a fee.
    flags.push(RISK_FLAGS.SELF_SEND);
    level = worst(level, "warning");
  }

  const poison = looksLikePoisoning(normalized, historyHint);
  if (poison.poisoned) {
    flags.push(RISK_FLAGS.POSSIBLE_POISON_ATTACK);
    level = worst(level, "critical");
    details.isPossiblePoisoning = true;
    details.matchedSimilarAddress = poison.matched;
  }

  return {
    address: normalized,
    chain,
    isValid: true,
    riskLevel: level,
    riskFlags: flags,
    details,
    summary: summaryFor(level, flags, poison.matched),
  };
}

function summaryFor(level: RiskLevel, flags: RiskFlag[], matched?: string): string {
  if (flags.includes(RISK_FLAGS.POSSIBLE_POISON_ATTACK)) {
    return `This address looks almost identical to one you've paid before (${matched?.slice(0, 6)}…${matched?.slice(-4)}) but is not the same address. Check every character before sending.`;
  }
  if (flags.includes(RISK_FLAGS.BURN_ADDRESS)) {
    return "This is a burn address. Anything sent here is destroyed and cannot be recovered.";
  }
  if (flags.includes(RISK_FLAGS.KNOWN_TOKEN_CONTRACT)) {
    return "This is a token contract, not a wallet. Funds sent here are usually unrecoverable.";
  }
  if (flags.includes(RISK_FLAGS.BAD_CHECKSUM)) {
    return "This address fails its checksum, which usually means a character was changed after it was copied.";
  }
  if (flags.includes(RISK_FLAGS.SELF_SEND)) {
    return "This is your own address. The transfer would succeed but only cost you the network fee.";
  }
  // Deliberately not "safe to send" — no client-side check can establish that.
  return level === "clean"
    ? "No known red flags. Always confirm the address with the recipient through a channel you trust."
    : "Check this address carefully before sending.";
}
