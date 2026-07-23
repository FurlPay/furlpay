import { describe, it, expect, afterEach } from "vitest";
import {
  checkDelegation,
  quoteGasInUsdc,
  sponsorshipAvailable,
  sponsoredCapability,
  ALLOWED_DELEGATES,
  REVOCATION_DELEGATE,
  SUPPORTED_7702_NETWORKS,
} from "@/lib/eip7702";

// ---------------------------------------------------------------------------
// EIP-7702 delegation safety.
//
// An EIP-7702 authorization points a user's EOA at code that executes with that
// account's full authority. It is the most dangerous signature a wallet can
// produce and there is no undo — an account that has been drained stays
// drained. These tests pin the checks that stop us asking for a bad one.
// ---------------------------------------------------------------------------

const VALID = "0x" + "1".repeat(40);

afterEach(() => {
  delete process.env.CIRCLE_PAYMASTER_ADDRESS_ARBITRUM;
  delete process.env.ERC4337_BUNDLER_URL_ARBITRUM;
});

describe("delegation — fails closed by default", () => {
  it("ships with NO allowlisted delegates, so every delegation is refused", () => {
    // The correct default. A populated-by-guesswork allowlist would be worse
    // than an empty one: an unverified implementation address is exactly the
    // thing that drains accounts.
    for (const net of SUPPORTED_7702_NETWORKS) {
      expect(ALLOWED_DELEGATES[net], `${net} must ship empty`).toEqual([]);
    }
  });

  it("refuses a well-formed but unknown delegate", () => {
    // Syntactic validity is not safety. This is the single most important
    // assertion in the file: accepting an attacker-supplied address here would
    // make the endpoint a signing oracle for account drainage.
    const r = checkDelegation({ chainId: 42161, address: VALID, nonce: 0 }, "arbitrum");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("delegate_not_allowed");
  });
});

describe("delegation — revocation is always permitted", () => {
  it("allows delegating to the zero address even with an empty allowlist", () => {
    // Refusing to help a user UN-delegate would be indefensible — it is the one
    // action that can only reduce their exposure. A user escaping a bad
    // delegation must never be blocked by an unpopulated allowlist.
    const r = checkDelegation(
      { chainId: 42161, address: REVOCATION_DELEGATE, nonce: 3 },
      "arbitrum"
    );
    expect(r.ok).toBe(true);
    expect(r.revoking).toBe(true);
  });

  it("treats a checksummed zero address as revocation too", () => {
    const r = checkDelegation(
      { chainId: 8453, address: REVOCATION_DELEGATE.toUpperCase().replace("0X", "0x"), nonce: 0 },
      "base"
    );
    expect(r.ok).toBe(true);
    expect(r.revoking).toBe(true);
  });
});

describe("delegation — chain binding", () => {
  it("REFUSES chainId 0, EIP-7702's all-chains wildcard", () => {
    // A signature valid on every chain is replayable onto every chain the user
    // holds funds on, turning one careless signature into total loss.
    const r = checkDelegation({ chainId: 0, address: REVOCATION_DELEGATE, nonce: 0 }, "arbitrum");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("chain_id_mismatch");
  });

  it("refuses an authorization signed for a different chain", () => {
    // Base's chain id presented as an Arbitrum delegation.
    const r = checkDelegation({ chainId: 8453, address: REVOCATION_DELEGATE, nonce: 0 }, "arbitrum");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("chain_id_mismatch");
  });

  it("accepts the correct chain id per supported network", () => {
    const ids: Record<string, number> = { arbitrum: 42161, base: 8453, ethereum: 1 };
    for (const [net, id] of Object.entries(ids)) {
      const r = checkDelegation({ chainId: id, address: REVOCATION_DELEGATE, nonce: 0 }, net);
      expect(r.ok, net).toBe(true);
    }
  });

  it("refuses an unsupported network", () => {
    const r = checkDelegation({ chainId: 137, address: REVOCATION_DELEGATE, nonce: 0 }, "polygon");
    expect(r.reason).toBe("unsupported_network");
  });
});

describe("delegation — input validation", () => {
  it("refuses a malformed address", () => {
    for (const bad of ["0x123", "not-an-address", "", "0x" + "g".repeat(40)]) {
      const r = checkDelegation({ chainId: 42161, address: bad, nonce: 0 }, "arbitrum");
      expect(r.reason, bad).toBe("malformed_address");
    }
  });

  it("refuses a negative or non-integer nonce", () => {
    for (const nonce of [-1, 1.5, NaN]) {
      const r = checkDelegation(
        { chainId: 42161, address: REVOCATION_DELEGATE, nonce },
        "arbitrum"
      );
      expect(r.reason, String(nonce)).toBe("invalid_nonce");
    }
  });
});

describe("sponsorship availability — asked before signing, not after", () => {
  it("reports unavailable and names every missing piece", () => {
    const a = sponsorshipAvailable("arbitrum");
    expect(a.available).toBe(false);
    // Diagnosable: a misconfiguration should say which variable is absent.
    expect(a.missing).toContain("CIRCLE_PAYMASTER_ADDRESS_ARBITRUM");
    expect(a.missing).toContain("ERC4337_BUNDLER_URL_ARBITRUM");
    expect(a.missing).toContain("allowed_delegate_implementations");
  });

  it("still reports unavailable with a paymaster but no bundler", () => {
    process.env.CIRCLE_PAYMASTER_ADDRESS_ARBITRUM = VALID;
    const a = sponsorshipAvailable("arbitrum");
    expect(a.available).toBe(false);
    expect(a.missing).not.toContain("CIRCLE_PAYMASTER_ADDRESS_ARBITRUM");
    expect(a.missing).toContain("ERC4337_BUNDLER_URL_ARBITRUM");
  });

  it("ignores a malformed paymaster address rather than trusting it", () => {
    process.env.CIRCLE_PAYMASTER_ADDRESS_ARBITRUM = "not-an-address";
    expect(sponsorshipAvailable("arbitrum").missing).toContain(
      "CIRCLE_PAYMASTER_ADDRESS_ARBITRUM"
    );
  });

  it("rejects an unsupported network", () => {
    expect(sponsorshipAvailable("solana").available).toBe(false);
  });
});

describe("gas quoting in USDC", () => {
  // 100k gas at 0.01 gwei with ETH at $3,000:
  //   1e5 * 1e7 wei = 1e12 wei = 1e-6 ETH = $0.003 -> 3000 atomic USDC
  //   +20% buffer -> 3600
  it("computes the cost in integer USDC atomic units", () => {
    const q = quoteGasInUsdc({
      network: "arbitrum",
      gasUnits: 100_000n,
      gasPriceWei: 10_000_000n,
      nativeUsdPrice: 3000,
    });
    expect(q.basis).toBe("estimated");
    expect(q.maxCostUsdcAtomic).toBe("3600");
    expect(q.maxCostUsdc).toBeCloseTo(0.0036, 6);
  });

  it("applies the buffer, and a larger buffer costs more", () => {
    const base = { network: "arbitrum", gasUnits: 100_000n, gasPriceWei: 10_000_000n, nativeUsdPrice: 3000 };
    const low = quoteGasInUsdc({ ...base, bufferPct: 0 });
    const high = quoteGasInUsdc({ ...base, bufferPct: 50 });
    expect(BigInt(low.maxCostUsdcAtomic)).toBe(3000n);
    expect(BigInt(high.maxCostUsdcAtomic)).toBe(4500n);
  });

  it("never quotes zero for a non-zero cost", () => {
    // A sub-atomic estimate must round UP to 1, not down to 0: a quote short by
    // a fraction of a cent leaves the Paymaster underpaid and the operation
    // rejected AFTER the user has already signed.
    const q = quoteGasInUsdc({
      network: "arbitrum",
      gasUnits: 1n,
      gasPriceWei: 1n,
      nativeUsdPrice: 3000,
    });
    expect(BigInt(q.maxCostUsdcAtomic)).toBeGreaterThan(0n);
  });

  it("returns `unavailable` rather than a fake zero on bad inputs", () => {
    for (const bad of [
      { gasUnits: 0n, gasPriceWei: 1n, nativeUsdPrice: 3000 },
      { gasUnits: 1n, gasPriceWei: 0n, nativeUsdPrice: 3000 },
      { gasUnits: 1n, gasPriceWei: 1n, nativeUsdPrice: 0 },
    ]) {
      const q = quoteGasInUsdc({ network: "arbitrum", ...bad });
      expect(q.basis).toBe("unavailable");
    }
  });

  it("stays exact at magnitudes where float arithmetic would drift", () => {
    // Mainnet-scale: 250k gas at 30 gwei, ETH $3,333.33.
    const q = quoteGasInUsdc({
      network: "ethereum",
      gasUnits: 250_000n,
      gasPriceWei: 30_000_000_000n,
      nativeUsdPrice: 3333.33,
      bufferPct: 0,
    });
    // 250000 * 3e10 = 7.5e15 wei = 0.0075 ETH = $24.99997... -> 24999975 atomic
    expect(q.maxCostUsdcAtomic).toBe("24999975");
    expect(Number.isInteger(Number(q.maxCostUsdcAtomic))).toBe(true);
  });
});

describe("capability document", () => {
  it("reports anyAvailable false while nothing is configured", () => {
    const cap = sponsoredCapability();
    expect(cap.scheme).toBe("eip7702-circle-paymaster");
    expect(cap.anyAvailable).toBe(false);
    expect(cap.availability).toHaveLength(SUPPORTED_7702_NETWORKS.length);
    expect(cap.asset).toEqual({ symbol: "USDC", decimals: 6 });
  });
});
