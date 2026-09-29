import { describe, it, expect } from "vitest";
import {
  resolveSettlementAsset,
  settlementAssetsFor,
  settlementNetworks,
  settlementGasLimit,
  parseAtomicAmount,
  MIN_GAS_LIMIT,
  MAX_GAS_LIMIT,
} from "../x402Assets";
import { verify, SUPPORTED_KINDS } from "../x402Facilitator";
import { NETWORK_USDC, NETWORK_XSGD, X402_VERSION } from "../x402";

// ---------------------------------------------------------------------------
// F-7: arbitrary-contract settlement (SR8) and unbounded sponsored gas (SR6).
//
// THE ATTACK THESE TESTS REPRODUCE. `paymentRequirements.asset` arrived in the
// request body and was passed to writeContract() as the contract address while
// OUR fee-payer paid the gas. Every other check in verify() compared one request
// field against another request field, so an attacker supplying a consistent set
// of them passed all of them:
//
//     asset            = their own contract M
//     extra.name       = whatever domain they signed over
//     payTo / auth.to  = equal, both theirs
//     maxAmountRequired / auth.value = consistent, both theirs
//     signature        = genuinely valid, over the domain they chose
//
// verify() returned isValid, settle() called M with our gas and no ceiling, and
// the endpoint is unauthenticated by protocol design at 30 req/min/IP.
//
// The tests below are written as the attacker, not as the implementer.
// ---------------------------------------------------------------------------

const ATTACKER_CONTRACT = "0xdeadBEEFdeadBEEFdeadBEEFdeadBEEFdeadBEEF";
const ATTACKER_EOA = "0x1111111111111111111111111111111111111111";
const REAL_USDC_ARBITRUM = NETWORK_USDC.arbitrum;

/** A payload the attacker fully controls, internally consistent throughout. */
function attackerRequest(overrides: { asset?: string; network?: string; extra?: Record<string, string> } = {}) {
  const network = overrides.network ?? "arbitrum";
  return {
    x402Version: X402_VERSION,
    paymentPayload: {
      x402Version: X402_VERSION,
      scheme: "exact",
      network,
      payload: {
        // 65-byte signature, well-formed. In the real attack this verifies,
        // because the attacker signs over a domain they chose.
        signature: "0x" + "ab".repeat(65),
        authorization: {
          from: ATTACKER_EOA,
          to: ATTACKER_EOA,
          value: "1",
          validAfter: "0",
          validBefore: String(Math.floor(Date.now() / 1000) + 3600),
          nonce: "0x" + "cd".repeat(32),
        },
      },
    },
    paymentRequirements: {
      scheme: "exact" as const,
      network,
      maxAmountRequired: "1",
      resource: "https://attacker.example/resource",
      description: "",
      mimeType: "application/json",
      payTo: ATTACKER_EOA,
      maxTimeoutSeconds: 60,
      asset: overrides.asset ?? ATTACKER_CONTRACT,
      extra: overrides.extra ?? { name: "Evil Token", version: "9" },
    },
  };
}

describe("F-7 SR8: the settlement contract is pinned, not taken from the request", () => {
  it("BLOCKS the attack: a payload naming an attacker contract is refused", async () => {
    const result = await verify(attackerRequest() as never);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("asset_not_allowed");
  });

  it("the refusal happens BEFORE any signature work, so it costs nothing", async () => {
    // A malformed signature would also fail, but for the wrong reason. Asserting
    // the asset reason proves the asset gate runs first — which is what makes
    // this cheap to refuse at 30 req/min from an unauthenticated caller.
    const result = await verify(attackerRequest() as never);
    expect(result.invalidReason).toBe("asset_not_allowed");
    expect(result.invalidReason).not.toMatch(/signature/);
  });

  it("a non-address asset is refused as malformed, not merely disallowed", async () => {
    for (const bad of ["", "not-an-address", "0x123", ATTACKER_CONTRACT + "00", "0xZZZZ"]) {
      const result = await verify(attackerRequest({ asset: bad }) as never);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("asset_malformed");
    }
  });

  it("the real USDC address on a supported network resolves", () => {
    const r = resolveSettlementAsset("arbitrum", REAL_USDC_ARBITRUM);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.address).toBe(REAL_USDC_ARBITRUM);
      // Domain comes from OUR registry, never from extra.
      expect(r.domainName).toBe("USD Coin");
      expect(r.domainVersion).toBe("2");
    }
  });

  it("address comparison is case-insensitive, so a checksum variant still resolves", () => {
    const upper = "0x" + REAL_USDC_ARBITRUM.slice(2).toUpperCase();
    const lower = REAL_USDC_ARBITRUM.toLowerCase();
    expect(resolveSettlementAsset("arbitrum", upper).ok).toBe(true);
    expect(resolveSettlementAsset("arbitrum", lower).ok).toBe(true);
  });

  it("CROSS-NETWORK: an asset valid on one network is refused on another", () => {
    // Base USDC is a real, legitimate contract — just not on Arbitrum. Accepting
    // it there would send funds to an address the recipient may not control.
    const baseUsdc = NETWORK_USDC.base;
    expect(resolveSettlementAsset("base", baseUsdc).ok).toBe(true);
    const wrongNetwork = resolveSettlementAsset("arbitrum", baseUsdc);
    expect(wrongNetwork.ok).toBe(false);
    if (!wrongNetwork.ok) expect(wrongNetwork.reason).toBe("asset_not_allowed");
  });

  it("an unadvertised network resolves nothing, even for a real token", () => {
    // polygon and solana have registry entries but are not in SUPPORTED_KINDS.
    for (const network of ["polygon", "solana", "ethereum", "arc", "made-up"]) {
      const r = resolveSettlementAsset(network, NETWORK_USDC[network] ?? REAL_USDC_ARBITRUM);
      expect(r.ok).toBe(false);
    }
  });

  it("the allowlist covers exactly the networks the facilitator advertises", () => {
    // A network we promise to settle but cannot pin an asset for would fail every
    // payment; a network we pin without advertising is dead configuration.
    const advertised = [...new Set(SUPPORTED_KINDS.map((k) => k.network))].sort();
    expect(settlementNetworks().slice().sort()).toEqual(advertised);
  });

  it("every allowlisted address is a well-formed 20-byte address", () => {
    for (const network of settlementNetworks()) {
      const assets = settlementAssetsFor(network);
      expect(assets.length).toBeGreaterThan(0);
      for (const a of assets) {
        expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(a.domainName.length).toBeGreaterThan(0);
        expect(a.domainVersion.length).toBeGreaterThan(0);
      }
    }
  });

  it("XSGD on Arbitrum is allowlisted when the registry has an address for it", () => {
    if (!NETWORK_XSGD.arbitrum) return; // registry-driven; skip if unset
    const r = resolveSettlementAsset("arbitrum", NETWORK_XSGD.arbitrum);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.symbol).toBe("XSGD");
  });

  it("the X402_USDC_ADDRESS override cannot widen the allowlist", () => {
    // That env var exists so a devnet can point the PAYER at a mock token.
    // Honouring it here would reopen the hole one environment variable at a time.
    const previous = process.env.X402_USDC_ADDRESS;
    process.env.X402_USDC_ADDRESS = ATTACKER_CONTRACT;
    try {
      expect(resolveSettlementAsset("arbitrum", ATTACKER_CONTRACT).ok).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.X402_USDC_ADDRESS;
      else process.env.X402_USDC_ADDRESS = previous;
    }
  });
});

describe("F-7 SR6: sponsored gas is bounded", () => {
  const withEnv = (value: string | undefined, fn: () => void) => {
    const previous = process.env.X402_SETTLEMENT_GAS_LIMIT;
    if (value === undefined) delete process.env.X402_SETTLEMENT_GAS_LIMIT;
    else process.env.X402_SETTLEMENT_GAS_LIMIT = value;
    try {
      fn();
    } finally {
      if (previous === undefined) delete process.env.X402_SETTLEMENT_GAS_LIMIT;
      else process.env.X402_SETTLEMENT_GAS_LIMIT = previous;
    }
  };

  it("defaults to a ceiling derived from the operation, not to unlimited", () => {
    withEnv(undefined, () => {
      const limit = settlementGasLimit();
      expect(limit).toBe(200_000n);
      // transferWithAuthorization costs well under 100k; the bound must leave
      // headroom without ceasing to bound.
      expect(limit).toBeGreaterThan(100_000n);
      expect(limit).toBeLessThanOrEqual(MAX_GAS_LIMIT);
    });
  });

  it("honours a valid in-range override", () => {
    withEnv("150000", () => expect(settlementGasLimit()).toBe(150_000n));
    withEnv(String(MIN_GAS_LIMIT), () => expect(settlementGasLimit()).toBe(MIN_GAS_LIMIT));
    withEnv(String(MAX_GAS_LIMIT), () => expect(settlementGasLimit()).toBe(MAX_GAS_LIMIT));
  });

  it("a misconfiguration falls back to the default rather than removing the bound", () => {
    // Each of these is a plausible typo. None may result in an unbounded spend,
    // and none may take settlement down either.
    for (const bad of ["0", "1", "20999", "1000001", "99999999999", "-5", "abc", "1e6", "200_000", " "]) {
      withEnv(bad, () => {
        const limit = settlementGasLimit();
        expect(limit).toBe(200_000n);
        expect(limit).toBeGreaterThanOrEqual(MIN_GAS_LIMIT);
        expect(limit).toBeLessThanOrEqual(MAX_GAS_LIMIT);
      });
    }
  });

  it("the ceiling is always within the permitted range for any input", () => {
    const inputs = [undefined, "", "0", "21000", "200000", "1000000", "1000001", "garbage", "-1"];
    for (const v of inputs) {
      withEnv(v, () => {
        const limit = settlementGasLimit();
        expect(limit).toBeGreaterThanOrEqual(MIN_GAS_LIMIT);
        expect(limit).toBeLessThanOrEqual(MAX_GAS_LIMIT);
      });
    }
  });
});

describe("F-8 SR5: economically meaningless payments are refused", () => {
  // Found by a LIVE request against a production build, not by reading the code:
  // with a real USDC asset (so the F-7 gate passes) and maxAmountRequired "-1",
  // verify() answered isValid:true. `BigInt("1") < BigInt("-1")` is false, so a
  // negative requirement was satisfied by any amount at all.
  //
  // Not a theft path — the amount transferred is the payer's own signed
  // `auth.value` — but a facilitator that certifies a nonsensical requirement is
  // still certifying it, and a resource server is entitled to rely on that.
  const REAL_USDC = NETWORK_USDC.arbitrum;

  function wellFormed(over: { required?: string; value?: string } = {}) {
    return {
      x402Version: X402_VERSION,
      paymentPayload: {
        x402Version: X402_VERSION,
        scheme: "exact",
        network: "arbitrum",
        payload: {
          signature: "0x" + "ab".repeat(65),
          authorization: {
            from: ATTACKER_EOA,
            to: ATTACKER_EOA,
            value: over.value ?? "1",
            validAfter: "0",
            validBefore: "99999999999",
            nonce: "0x" + "cd".repeat(32),
          },
        },
      },
      paymentRequirements: {
        scheme: "exact" as const,
        network: "arbitrum",
        maxAmountRequired: over.required ?? "1",
        resource: "https://api.example.com/data",
        description: "",
        mimeType: "application/json",
        payTo: ATTACKER_EOA,
        maxTimeoutSeconds: 60,
        asset: REAL_USDC,
      },
    };
  }

  it("a NEGATIVE required amount is refused, not trivially satisfied", async () => {
    const r = await verify(wellFormed({ required: "-1" }) as never);
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toBe("invalid_required_amount");
  });

  it("a ZERO required amount is refused", async () => {
    const r = await verify(wellFormed({ required: "0" }) as never);
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toBe("invalid_required_amount");
  });

  it("a non-positive OFFERED amount is refused as invalid, not as insufficient", async () => {
    // "insufficient" invites the caller to send more. "invalid" says the value
    // itself is not a payment.
    for (const value of ["0", "-5"]) {
      const r = await verify(wellFormed({ value }) as never);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("invalid_amount");
    }
  });

  it("a positive requirement still passes, so the fix is not over-eager", async () => {
    const r = await verify(wellFormed({ required: "1", value: "1" }) as never);
    expect(r.isValid).toBe(true);
  });

  it("an underpayment is still reported as insufficient, distinctly", async () => {
    const r = await verify(wellFormed({ required: "100", value: "1" }) as never);
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toBe("insufficient_amount");
  });

  it("an unparseable amount is refused rather than throwing", async () => {
    for (const bad of ["abc", "1.5", "", "1e6", "0x10"]) {
      const r = await verify(wellFormed({ value: bad }) as never);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("invalid_amount");
    }
  });
});

describe("F-9: atomic amounts must be canonical decimal strings", () => {
  // BigInt() is a lenient COERCION, not a validator. Each value below was
  // measured: BigInt("0x10") is 16n, BigInt(" 1 ") is 1n, BigInt("") is 0n.
  // "0x10" was the one that slipped through — 16 is positive and clears a
  // requirement of 1, so verify() answered isValid for a hexadecimal amount.
  it("parseAtomicAmount accepts only unsigned decimal digits", () => {
    expect(parseAtomicAmount("0")).toBe(0n);
    expect(parseAtomicAmount("1")).toBe(1n);
    expect(parseAtomicAmount("1000000")).toBe(1_000_000n);
    // Leading zeros are numerically unambiguous and some clients zero-pad.
    expect(parseAtomicAmount("007")).toBe(7n);
  });

  it("every form BigInt() would silently coerce is refused", () => {
    const coercible: Array<[string, bigint]> = [
      ["0x10", 16n],
      ["0b101", 5n],
      ["0o17", 15n],
      ["+5", 5n],
      [" 1 ", 1n],
      ["\n7\t", 7n],
      ["", 0n],
    ];
    for (const [input, whatBigIntWouldGive] of coercible) {
      // Demonstrate the coercion is real, then that we refuse it.
      expect(BigInt(input)).toBe(whatBigIntWouldGive);
      expect(parseAtomicAmount(input)).toBeNull();
    }
  });

  it("forms BigInt() already rejects are refused without throwing", () => {
    for (const input of ["abc", "1.5", "1e6", "1_000", "１", "-5", "Infinity", "NaN"]) {
      expect(parseAtomicAmount(input)).toBeNull();
    }
  });

  it("non-strings are refused rather than coerced", () => {
    for (const input of [null, undefined, 1, 1.5, {}, [], true, 10n]) {
      expect(parseAtomicAmount(input)).toBeNull();
    }
  });

  it("verify() refuses a HEXADECIMAL amount end to end", async () => {
    const req = {
      x402Version: X402_VERSION,
      paymentPayload: {
        x402Version: X402_VERSION,
        scheme: "exact",
        network: "arbitrum",
        payload: {
          signature: "0x" + "ab".repeat(65),
          authorization: {
            from: ATTACKER_EOA,
            to: ATTACKER_EOA,
            value: "0x10",
            validAfter: "0",
            validBefore: "99999999999",
            nonce: "0x" + "cd".repeat(32),
          },
        },
      },
      paymentRequirements: {
        scheme: "exact" as const,
        network: "arbitrum",
        maxAmountRequired: "1",
        resource: "https://api.example.com/data",
        description: "",
        mimeType: "application/json",
        payTo: ATTACKER_EOA,
        maxTimeoutSeconds: 60,
        asset: NETWORK_USDC.arbitrum,
      },
    };
    const r = await verify(req as never);
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toBe("invalid_amount");
  });

  it("a hexadecimal REQUIREMENT is refused too", async () => {
    const req = {
      x402Version: X402_VERSION,
      paymentPayload: {
        x402Version: X402_VERSION,
        scheme: "exact",
        network: "arbitrum",
        payload: {
          signature: "0x" + "ab".repeat(65),
          authorization: {
            from: ATTACKER_EOA,
            to: ATTACKER_EOA,
            value: "100",
            validAfter: "0",
            validBefore: "99999999999",
            nonce: "0x" + "cd".repeat(32),
          },
        },
      },
      paymentRequirements: {
        scheme: "exact" as const,
        network: "arbitrum",
        maxAmountRequired: "0x10",
        resource: "https://api.example.com/data",
        description: "",
        mimeType: "application/json",
        payTo: ATTACKER_EOA,
        maxTimeoutSeconds: 60,
        asset: NETWORK_USDC.arbitrum,
      },
    };
    const r = await verify(req as never);
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toBe("invalid_required_amount");
  });

  it("agrees with @furlpay/control-plane on every DANGEROUS form", async () => {
    // Imported by RELATIVE PATH, not as a package. @furlpay/control-plane is
    // deliberately not an apps/web dependency — it is a tested library that
    // nothing imports yet — and adding one just to satisfy a test would
    // contradict that classification. This reads the source directly.
    const { parseAtomic } = await import("../../../../../packages/control-plane/src/units");

    // The forms that MUST be refused by both, because a radix prefix or an
    // empty string means the two parsers would disagree about a value's size.
    for (const input of ["0x10", "0b101", "0o17", "+5", "", "1.5", "1e6", "abc", "1_000"]) {
      expect(parseAtomic(input), `control-plane must refuse ${JSON.stringify(input)}`).toBeNull();
      expect(parseAtomicAmount(input), `wire parser must refuse ${JSON.stringify(input)}`).toBeNull();
    }

    // And both accept plain decimal digits.
    for (const input of ["0", "1", "007", "1000000"]) {
      expect(parseAtomic(input)).not.toBeNull();
      expect(parseAtomicAmount(input)).not.toBeNull();
    }
  });

  it("documents the two places the rules legitimately DIFFER", async () => {
    const { parseAtomic } = await import("../../../../../packages/control-plane/src/units");

    // 1. SURROUNDING WHITESPACE. control-plane trims before matching, because it
    //    parses values from our own store and config where a stray space is a
    //    typo rather than an attack. The WIRE parser refuses it, because the raw
    //    string is written verbatim into the settlement record and is compared
    //    textually by resource servers — so " 1 " and "1" must not both be
    //    accepted as the same payment.
    expect(parseAtomic(" 1 ")).toBe(1n);
    expect(parseAtomicAmount(" 1 ")).toBeNull();

    // 2. SIGN. control-plane models signed ledger deltas, so "-5" parses there.
    //    A wire amount is never negative.
    expect(parseAtomic("-5")).toBe(-5n);
    expect(parseAtomicAmount("-5")).toBeNull();

    // The divergence is one-directional: anything the wire parser accepts, the
    // control-plane parser also accepts. The wire rule is strictly tighter, so a
    // value that passes the gate can never be re-read differently downstream.
    for (const input of ["0", "1", "007", "1000000", "999999999999999999999"]) {
      expect(parseAtomicAmount(input)).not.toBeNull();
      expect(parseAtomic(input)).toBe(parseAtomicAmount(input));
    }
  });
});
