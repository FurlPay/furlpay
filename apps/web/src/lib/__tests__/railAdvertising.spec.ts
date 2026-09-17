import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SUPPORTED_KINDS } from "../x402Facilitator";
import { isCctpSupported, quoteCctp } from "../services/cctp";
import { CCTP_DOMAINS } from "../services/cctpExecution";
import { planIntent } from "../services/intentRouter";
import { EVM_CHAIN_IDS } from "../x402Signature";
import { clearCctpFeeCache } from "../services/cctpFees";
import type { Chain } from "@furlpay/types";

// ---------------------------------------------------------------------------
// What a rail ADVERTISES must equal what it can DO.
//
// Two lists in this repo drifted away from the code behind them, and both
// failures looked identical from outside: a caller is told a route exists,
// commits to it, and is refused at the last step.
//
//   1. `/api/x402/facilitator/supported` listed "solana". EVM_CHAIN_IDS has no
//      Solana entry, so verification returns `svm_verification_unavailable`
//      and defaultSettler() builds an EVM settler only. `/supported` is how an
//      agent CHOOSES a facilitator, so every agent that picked us for Solana
//      earned a guaranteed rejection.
//
//   2. `CCTP_CHAINS` (quoting) listed "solana" while `CCTP_DOMAINS`
//      (execution) did not. intentRouter.planIntent() selects a rail off
//      isCctpSupported(), so a Solana leg was planned, priced and promised at a
//      20-second ETA — then refused by /api/intents/cctp, without ever falling
//      back to Li.Fi the way a genuinely unsupported pair does.
//
// Neither list had a test. These are the tests. They are deliberately written
// as INVARIANTS ("quote set == execute set") rather than as "solana is absent",
// so they keep holding when Solana is added back properly — and fail the moment
// someone adds a chain to one list only.
// ---------------------------------------------------------------------------

describe("x402 facilitator advertises only what it can settle", () => {
  it("every advertised network has an EVM chain id to verify against", () => {
    for (const kind of SUPPORTED_KINDS) {
      expect(
        EVM_CHAIN_IDS[kind.network],
        `/supported advertises "${kind.network}", but EVM_CHAIN_IDS has no entry for it — ` +
          `verifyAuthorizationSignature() will return svm_verification_unavailable and every ` +
          `payment on this network is refused. Remove it from NETWORKS or add the verifier.`
      ).toBeTypeOf("number");
    }
  });

  it("advertises both protocol versions for the same network set", () => {
    const v1 = SUPPORTED_KINDS.filter((k) => k.x402Version === 1).map((k) => k.network).sort();
    const v2 = SUPPORTED_KINDS.filter((k) => k.x402Version === 2).map((k) => k.network).sort();
    expect(v2).toEqual(v1);
  });

  it("does not advertise a network with no settler (regression: solana)", () => {
    expect(SUPPORTED_KINDS.map((k) => k.network)).not.toContain("solana");
  });
});

describe("CCTP quoting and execution cover the same chains", () => {
  const executable = Object.keys(CCTP_DOMAINS) as Chain[];

  it("every chain we can execute, we can also quote", () => {
    for (const chain of executable) {
      expect(
        isCctpSupported(chain),
        `CCTP_DOMAINS can execute "${chain}" but CCTP_CHAINS will not quote it — ` +
          `the router will never select the CCTP rail for a chain we can actually burn on.`
      ).toBe(true);
    }
  });

  it("every chain we quote, we can also execute", () => {
    const quotable: Chain[] = ["ethereum", "base", "arbitrum", "polygon", "solana", "optimism"] as Chain[];
    for (const chain of quotable) {
      if (!isCctpSupported(chain)) continue;
      expect(
        CCTP_DOMAINS[chain],
        `CCTP_CHAINS quotes "${chain}" but CCTP_DOMAINS cannot execute it — ` +
          `planIntent() will promise a CCTP route that /api/intents/cctp refuses, ` +
          `and the Li.Fi fallback is skipped because the rail was already chosen.`
      ).toBeTypeOf("number");
    }
  });
});

describe("intentRouter never plans a rail it cannot execute", () => {
  // planIntent now prices CCTP from Circle's published fee. Stub the endpoint
  // with its real response shape so these stay invariant tests about ROUTING,
  // not network tests — cctpFees.spec.ts covers the fetching itself.
  beforeEach(() => {
    clearCctpFeeCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify([
        { finalityThreshold: 1000, minimumFee: 1.4 },
        { finalityThreshold: 2000, minimumFee: 0 },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    )));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCctpFeeCache();
  });

  it("routes USDC arbitrum -> base over CCTP", async () => {
    const plan = await planIntent({
      fromToken: "USDC",
      toToken: "USDC",
      fromChain: "arbitrum",
      toChain: "base",
      amount: 100,
    });
    expect(plan.rail).toBe("cctp-v2");
    expect(CCTP_DOMAINS.arbitrum).toBeTypeOf("number");
    expect(CCTP_DOMAINS.base).toBeTypeOf("number");
  });

  it("does NOT route a Solana leg over CCTP (regression)", async () => {
    // The planner's own docstring used "arbitrum -> solana" as its worked
    // example, and returned rail "cctp-v2" with a 20s ETA for it. Execution
    // has no Solana domain, so that plan was unfulfillable.
    const plan = await planIntent({
      fromToken: "USDC",
      toToken: "USDC",
      fromChain: "arbitrum",
      toChain: "solana",
      amount: 100,
    });
    expect(plan.rail).not.toBe("cctp-v2");
  });

  it("a planned CCTP route is always executable", async () => {
    const chains: Chain[] = ["ethereum", "base", "arbitrum", "polygon"];
    for (const from of chains) {
      for (const to of chains) {
        if (from === to) continue;
        const plan = await planIntent({
          fromToken: "USDC",
          toToken: "USDC",
          fromChain: from,
          toChain: to,
          amount: 50,
        });
        if (plan.rail !== "cctp-v2") continue;
        expect(CCTP_DOMAINS[from], `planned CCTP burn on ${from} with no domain`).toBeTypeOf("number");
        expect(CCTP_DOMAINS[to], `planned CCTP mint on ${to} with no domain`).toBeTypeOf("number");
      }
    }
  });
});

describe("quoteCctp refuses what it cannot route", () => {
  it("rejects rather than pricing an unsupported chain", async () => {
    await expect(
      quoteCctp({ fromChain: "arbitrum", toChain: "solana" as Chain, amount: 100 })
    ).rejects.toThrow(/not supported/i);
  });
});
