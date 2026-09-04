import { describe, it, expect } from "vitest";
import { checkBitcoinAddress, checkBitcoinDestination, addressTypeLabel } from "../bitcoin";
import {
  availableRails,
  canReceivePayout,
  checkRailDestination,
  payoutBlockedReason,
  railStatus,
  type PaymentMethod,
} from "../rails";

// ---------------------------------------------------------------------------
// Bitcoin destinations and the rail dispatcher.
//
// The defect class under test is BIP-350: witness v0 uses bech32, witness v1+
// uses bech32m, and the two checksums differ by one constant. An implementation
// that decodes everything with bech32 accepts corrupted Taproot addresses and
// rejects valid ones — and a corrupted Bitcoin address is an unspendable
// payout, not a failed one.
//
// Vectors are the canonical BIP-173/BIP-350 test addresses.
// ---------------------------------------------------------------------------

const P2PKH = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const P2WPKH = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const P2WSH = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";
const P2TR = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";
const TESTNET_P2WPKH = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";

describe("bitcoin address types", () => {
  it("identifies all five supported script types", () => {
    const cases: [string, string][] = [
      [P2PKH, "p2pkh"],
      [P2SH, "p2sh"],
      [P2WPKH, "p2wpkh"],
      [P2WSH, "p2wsh"],
      [P2TR, "p2tr"],
    ];
    for (const [addr, type] of cases) {
      const r = checkBitcoinAddress(addr);
      expect(r.ok, `${addr} should be valid`).toBe(true);
      if (r.ok) expect(r.value.type).toBe(type);
    }
  });

  it("derives the network FROM the address rather than being told", () => {
    // The opposite of EVM. "bc" and "tb" name the network, and the base58
    // version byte does too — so a testnet address cannot be read as mainnet.
    const main = checkBitcoinAddress(P2WPKH);
    const test = checkBitcoinAddress(TESTNET_P2WPKH);
    expect(main.ok).toBe(true);
    expect(test.ok).toBe(true);
    if (main.ok) expect(main.value.network).toBe("bitcoin:mainnet");
    if (test.ok) expect(test.value.network).toBe("bitcoin:testnet");
  });

  it("records the witness version for segwit and null for base58", () => {
    const tr = checkBitcoinAddress(P2TR);
    const legacy = checkBitcoinAddress(P2PKH);
    if (tr.ok) expect(tr.value.witnessVersion).toBe(1);
    if (legacy.ok) expect(legacy.value.witnessVersion).toBeNull();
  });
});

describe("BIP-350 encoding rules", () => {
  it("rejects a Taproot address carrying a bech32 (v0) checksum", () => {
    // THE HEADLINE CASE. This is the BIP-350 invalid vector: a witness v1
    // address whose checksum was computed with bech32 instead of bech32m.
    // Accepting it would mean paying an address whose bits are not what the
    // recipient published.
    const wrong = "bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4";
    const r = checkBitcoinAddress(wrong);
    expect(r.ok).toBe(false);
  });

  it("rejects a v0 address carrying a bech32m checksum", () => {
    const wrong = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh";
    const r = checkBitcoinAddress(wrong);
    expect(r.ok).toBe(false);
  });

  it("rejects a corrupted checksum on an otherwise well-formed address", () => {
    const corrupted = P2TR.slice(0, -1) + (P2TR.endsWith("0") ? "2" : "0");
    expect(checkBitcoinAddress(corrupted).ok).toBe(false);
  });

  it("refuses mixed-case bech32, which BIP-173 forbids", () => {
    // Mixing case is banned precisely so a checksum cannot be laundered by
    // re-casing the string.
    const mixed = "bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
    const r = checkBitcoinAddress(mixed);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("uppercase_mixed");
  });

  it("accepts all-uppercase bech32, which is legal", () => {
    expect(checkBitcoinAddress(P2WPKH.toUpperCase()).ok).toBe(true);
  });
});

describe("bitcoin rejections", () => {
  it("refuses a witness version reserved for a future upgrade", () => {
    // Syntactically valid, and FurlPay cannot construct a spend for it. Paying
    // it would create an output nobody can currently claim.
    const v16 = "bc1sqqqqqp7hvrxu";
    const r = checkBitcoinAddress(v16);
    expect(r.ok).toBe(false);
  });

  it("refuses an empty or nonsense destination", () => {
    for (const bad of ["", "   ", "hello", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]) {
      expect(checkBitcoinAddress(bad).ok).toBe(false);
    }
  });

  it("names a network mismatch rather than silently re-homing it", () => {
    const r = checkBitcoinDestination(TESTNET_P2WPKH, "bitcoin:mainnet");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("network_mismatch");
  });

  it("accepts the matching network", () => {
    expect(checkBitcoinDestination(P2TR, "bitcoin:mainnet").ok).toBe(true);
  });

  it("labels script types for a confirmation screen", () => {
    expect(addressTypeLabel("p2tr")).toContain("Taproot");
    expect(addressTypeLabel("p2wpkh")).toContain("SegWit");
  });
});

describe("rail dispatch", () => {
  it("routes a Bitcoin address to the Bitcoin adapter", () => {
    const r = checkRailDestination({
      rail: "BITCOIN_ONCHAIN",
      network: "bitcoin:mainnet",
      destination: P2TR,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.assetSymbol).toBe("BTC");
      expect(r.decimals).toBe(8); // NOT 6 — BTC is not a stablecoin
      expect(r.addressType).toBe("p2tr");
      // The address names its own network, so there is nothing to confirm.
      expect(r.requiresNetworkConfirmation).toBe(false);
    }
  });

  it("routes an EVM address to the token adapter and demands confirmation", () => {
    const r = checkRailDestination({
      rail: "EVM",
      network: "base",
      destination: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.assetSymbol).toBe("USDC");
      expect(r.decimals).toBe(6);
      expect(r.requiresNetworkConfirmation).toBe(true);
    }
  });

  it("refuses a Bitcoin address submitted on the EVM rail", () => {
    const r = checkRailDestination({ rail: "EVM", network: "base", destination: P2TR });
    expect(r.ok).toBe(false);
  });

  it("refuses an EVM address submitted on the Bitcoin rail", () => {
    const r = checkRailDestination({
      rail: "BITCOIN_ONCHAIN",
      network: "bitcoin:mainnet",
      destination: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    expect(r.ok).toBe(false);
  });

  it("refuses a Solana network claimed on the EVM rail", () => {
    // Rail and network must agree. Solana settles on the Solana rail even
    // though both are "crypto".
    const r = checkRailDestination({
      rail: "EVM",
      network: "solana",
      destination: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("rail_network_mismatch");
  });

  it("declares Lightning unavailable instead of omitting it", () => {
    // A missing rail looks like an oversight; a declared-unavailable one is a
    // decision, and it stops the UI offering something payout would reject.
    expect(railStatus("BITCOIN_LIGHTNING")).toBe("not_implemented");
    expect(availableRails()).not.toContain("BITCOIN_LIGHTNING");
    const r = checkRailDestination({
      rail: "BITCOIN_LIGHTNING",
      network: "bitcoin:mainnet",
      destination: "lnbc1...",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("rail_not_implemented");
  });
});

describe("payout eligibility", () => {
  const method: PaymentMethod = {
    id: "pm_1",
    userId: "u1",
    discordUserId: "1234",
    rail: "BITCOIN_ONCHAIN",
    network: "bitcoin:mainnet",
    asset: "BTC",
    assetSymbol: "BTC",
    decimals: 8,
    destination: P2TR,
    addressType: "p2tr",
    verification: "VERIFIED",
    ownershipProof: "sig",
    isDefault: true,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cooldownUntil: null,
  };

  it("pays a verified, active, out-of-cooldown method", () => {
    expect(canReceivePayout(method)).toBe(true);
    expect(payoutBlockedReason(method)).toBeNull();
  });

  it("refuses every state that is not VERIFIED", () => {
    for (const v of ["UNVERIFIED", "PENDING_VERIFICATION", "SUSPENDED", "REVOKED"] as const) {
      const m = { ...method, verification: v };
      expect(canReceivePayout(m), v).toBe(false);
      expect(payoutBlockedReason(m)).toBe("not_verified");
    }
  });

  it("holds a destination that is still in its change cooldown", () => {
    // The window that stops a compromised account redirecting the next payout.
    const m = { ...method, cooldownUntil: new Date(Date.now() + 3_600_000).toISOString() };
    expect(canReceivePayout(m)).toBe(false);
    expect(payoutBlockedReason(m)).toBe("in_cooldown");
  });

  it("pays once the cooldown has passed", () => {
    const m = { ...method, cooldownUntil: new Date(Date.now() - 1000).toISOString() };
    expect(canReceivePayout(m)).toBe(true);
  });

  it("refuses an inactive method", () => {
    expect(canReceivePayout({ ...method, isActive: false })).toBe(false);
  });
});
