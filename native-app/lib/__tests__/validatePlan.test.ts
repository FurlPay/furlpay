import {
  assertFeesSane,
  assertFresh,
  assertPlanSignable,
  isNonZeroAddress,
  PlanRejected,
  type PlanShape,
} from "../swap/validatePlan";

// ---------------------------------------------------------------------------
// The gate between "the server said so" and "the user's key signed it".
//
// Every case here is a malformed or stale plan that would otherwise become a
// real signature. The chain-mismatch case is the one worth reading twice: the
// same address exists on every EVM chain, so a plan signed for the wrong
// chainId is a live transaction somewhere the user never chose.
// ---------------------------------------------------------------------------

const ROUTER = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
const TOKEN = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const NOW = Date.parse("2026-08-01T12:00:00Z");

function plan(overrides: Partial<PlanShape> = {}): PlanShape {
  return {
    approvalAddress: ROUTER,
    fromTokenAddress: TOKEN,
    fromAmountAtomic: "1000000",
    expiresAt: new Date(NOW + 60_000).toISOString(),
    transactionRequest: {
      to: ROUTER,
      data: "0xdeadbeef",
      value: "0x0",
      chainId: 42161,
      gasLimit: "0x5208",
    },
    ...overrides,
  };
}

const reasonOf = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    return (e as PlanRejected).reason;
  }
  throw new Error("expected a rejection");
};

describe("chain binding", () => {
  it("accepts a plan for the chain the user picked", () => {
    expect(() => assertPlanSignable(plan(), "arbitrum", NOW)).not.toThrow();
  });

  it("refuses a plan whose chainId is a DIFFERENT chain", () => {
    // Base's id on an Arbitrum swap. The address exists on both, so this would
    // otherwise be signed and be spendable on Base.
    const p = plan({ transactionRequest: { ...plan().transactionRequest, chainId: 8453 } });
    expect(reasonOf(() => assertPlanSignable(p, "arbitrum", NOW))).toBe("chain_mismatch");
  });

  it("refuses an unknown chain slug", () => {
    expect(reasonOf(() => assertPlanSignable(plan(), "solana" as never, NOW))).toBe(
      "unsupported_chain"
    );
  });
});

describe("address validation", () => {
  it("rejects a malformed or zero destination", () => {
    for (const to of ["0x123", "not-an-address", "", "0x" + "0".repeat(40)]) {
      const p = plan({ transactionRequest: { ...plan().transactionRequest, to } });
      expect(reasonOf(() => assertPlanSignable(p, "arbitrum", NOW))).toBe("bad_target");
    }
  });

  it("rejects a malformed spender", () => {
    expect(reasonOf(() => assertPlanSignable(plan({ approvalAddress: "0xzz" }), "arbitrum", NOW)))
      .toBe("bad_spender");
  });

  it("rejects an approval with no token", () => {
    expect(
      reasonOf(() => assertPlanSignable(plan({ fromTokenAddress: null }), "arbitrum", NOW))
    ).toBe("bad_token");
  });

  it("rejects a zero or non-numeric approval amount", () => {
    expect(reasonOf(() => assertPlanSignable(plan({ fromAmountAtomic: "0" }), "arbitrum", NOW)))
      .toBe("bad_amount");
    expect(reasonOf(() => assertPlanSignable(plan({ fromAmountAtomic: "1e6" }), "arbitrum", NOW)))
      .toBe("bad_amount");
  });

  it("treats the zero address as never valid", () => {
    expect(isNonZeroAddress("0x" + "0".repeat(40))).toBe(false);
    expect(isNonZeroAddress(ROUTER)).toBe(true);
  });

  it("skips approval checks entirely for a native sell", () => {
    const p = plan({ approvalAddress: null, fromTokenAddress: null, fromAmountAtomic: null });
    expect(() => assertPlanSignable(p, "arbitrum", NOW)).not.toThrow();
  });
});

describe("calldata and value", () => {
  it("rejects empty calldata — a swap is always a contract call", () => {
    const p = plan({ transactionRequest: { ...plan().transactionRequest, data: "0x" } });
    expect(reasonOf(() => assertPlanSignable(p, "arbitrum", NOW))).toBe("no_calldata");
  });

  it("rejects odd-length or non-hex calldata", () => {
    for (const data of ["0xabc", "deadbeef", "0xzz"]) {
      const p = plan({ transactionRequest: { ...plan().transactionRequest, data } });
      expect(reasonOf(() => assertPlanSignable(p, "arbitrum", NOW))).toBe("no_calldata");
    }
  });

  it("rejects a malformed value or a zero gas limit", () => {
    const bad = plan({ transactionRequest: { ...plan().transactionRequest, value: "100" } });
    expect(reasonOf(() => assertPlanSignable(bad, "arbitrum", NOW))).toBe("bad_value");

    const zeroGas = plan({ transactionRequest: { ...plan().transactionRequest, gasLimit: "0x0" } });
    expect(reasonOf(() => assertPlanSignable(zeroGas, "arbitrum", NOW))).toBe("bad_gas_limit");
  });
});

describe("freshness", () => {
  it("accepts a plan inside its window", () => {
    expect(() => assertFresh(plan(), NOW)).not.toThrow();
  });

  it("refuses a plan past its expiry", () => {
    expect(reasonOf(() => assertFresh(plan(), NOW + 61_000))).toBe("expired");
  });

  it("treats a missing or unreadable expiry as stale, not eternal", () => {
    // Li.Fi's /v1/quote carries no expiry, so ours is the only one there is.
    // Absence of a freshness guarantee is not a freshness guarantee.
    expect(reasonOf(() => assertFresh(plan({ expiresAt: undefined }), NOW))).toBe("no_expiry");
    expect(reasonOf(() => assertFresh(plan({ expiresAt: "soon" }), NOW))).toBe("no_expiry");
  });
});

describe("fee sanity", () => {
  const tx = {
    chainId: 42161,
    nonce: 1n,
    maxPriorityFeePerGas: 1n,
    maxFeePerGas: 100n,
    gasLimit: 21000n,
    to: ROUTER,
    value: 0n,
    data: "0x",
  };

  it("accepts sane fees", () => {
    expect(() => assertFeesSane(tx)).not.toThrow();
  });

  it("rejects a tip above the cap", () => {
    // Every node rejects this. Better to say so than to spend a biometric on it.
    expect(reasonOf(() => assertFeesSane({ ...tx, maxPriorityFeePerGas: 500n }))).toBe("bad_fees");
  });

  it("rejects a zero gas limit or a zero fee cap", () => {
    expect(reasonOf(() => assertFeesSane({ ...tx, gasLimit: 0n }))).toBe("bad_gas_limit");
    expect(reasonOf(() => assertFeesSane({ ...tx, maxFeePerGas: 0n }))).toBe("bad_fees");
  });
});
