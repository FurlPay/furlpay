import { describeSwap, presentSwap, swapTimeline } from "../swap/swapPresentation";
import type { SwapRecord } from "../swap/swapJournal";
import { explorerTxUrl, explorerAddressUrl, chainName } from "../explorer";

// ---------------------------------------------------------------------------
// The layer between machine states and what a person reads.
//
// Two things are pinned here and both are about honesty rather than polish:
//
//   1. No internal vocabulary reaches a screen. "NOT_FOUND" is a normal first
//      thirty seconds of a bridge and reads like lost funds.
//   2. A REFUNDED bridge is finished and NOT a success. Rendering it as
//      "completed" tells someone they received tokens they do not have.
// ---------------------------------------------------------------------------

function swap(overrides: Partial<SwapRecord> = {}): SwapRecord {
  return {
    id: "route-1",
    routeId: "route-1",
    status: "pending",
    step: null,
    fromChain: "arbitrum",
    toChain: "base",
    fromToken: "USDC",
    toToken: "USDC",
    amountIn: 100,
    amountOut: null,
    txHash: null,
    approvalTxHash: null,
    destTxHash: null,
    bridgeStatus: null,
    bridgeSubstatus: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Anything that would betray an internal state machine to a user. */
const INTERNAL = [
  "NOT_FOUND",
  "INVALID",
  "PENDING",
  "WAIT_DESTINATION_TRANSACTION",
  "WAIT_SOURCE_CONFIRMATIONS",
  "REFUND_IN_PROGRESS",
  "UNKNOWN_ERROR",
  "bridging",
  "reconciling",
  "undefined",
  "null",
  "NaN",
];

describe("no internal vocabulary reaches the screen", () => {
  it("keeps machine states out of every rendered string", () => {
    const cases: SwapRecord[] = [
      swap(),
      swap({ txHash: "0xabc" }),
      swap({ status: "bridging", txHash: "0xabc", bridgeStatus: "PENDING", bridgeSubstatus: "WAIT_DESTINATION_TRANSACTION" }),
      swap({ status: "bridging", bridgeStatus: "NOT_FOUND", txHash: "0xabc" }),
      swap({ status: "done", amountOut: 99.4 }),
      swap({ status: "failed", error: "The swap was mined but reverted on-chain.", txHash: "0xabc" }),
      swap({ status: "failed", bridgeSubstatus: "REFUNDED", txHash: "0xabc" }),
    ];

    for (const record of cases) {
      const view = presentSwap(record);
      const rendered = `${view.headline} ${view.detail}`;
      for (const token of INTERNAL) {
        expect(rendered).not.toContain(token);
      }
      // Something must always be said — a blank status row is worse than a
      // vague one.
      expect(view.headline.length).toBeGreaterThan(0);
    }
  });
});

describe("refunds are not successes", () => {
  it("presents a refunded bridge as a warning that names where the money went", () => {
    const view = presentSwap(swap({ status: "failed", bridgeSubstatus: "REFUNDED", txHash: "0xabc" }));

    expect(view.tone).toBe("warning");
    expect(view.headline).toMatch(/refund/i);
    // The critical reassurance: the funds came back, they are not gone.
    expect(view.detail).toMatch(/returned/i);
    expect(view.needsAttention).toBe(true);
  });

  it("marks a completed swap as a success and nothing else", () => {
    const view = presentSwap(swap({ status: "done", amountOut: 99.4 }));
    expect(view.tone).toBe("success");
    expect(view.inFlight).toBe(false);
    expect(view.needsAttention).toBe(false);
  });
});

describe("attention is reserved for swaps that need it", () => {
  it("does not flag a failure that never broadcast", () => {
    // Nothing left the wallet — there is nothing to investigate.
    const view = presentSwap(swap({ status: "failed", error: "That quote expired." }));
    expect(view.needsAttention).toBe(false);
  });

  it("flags a failure that already moved money", () => {
    const view = presentSwap(
      swap({ status: "failed", txHash: "0xabc", error: "The swap was mined but reverted on-chain." })
    );
    expect(view.needsAttention).toBe(true);
  });

  it("does not flag a bridge that is merely slow", () => {
    const view = presentSwap(swap({ status: "bridging", txHash: "0xabc" }));
    expect(view.inFlight).toBe(true);
    expect(view.needsAttention).toBe(false);
  });
});

describe("timeline", () => {
  it("omits the bridge leg for a same-chain swap", () => {
    // A permanently greyed-out "Arrived" row invites "is it stuck?" about a
    // step that was never going to run.
    const entries = swapTimeline(swap({ toChain: "arbitrum", status: "done", txHash: "0xabc" }));
    expect(entries.some((e) => /arrived/i.test(e.label))).toBe(false);
  });

  it("includes the bridge leg for a cross-chain swap", () => {
    const entries = swapTimeline(swap({ status: "done", txHash: "0xabc" }));
    expect(entries.some((e) => e.label.includes("base"))).toBe(true);
  });

  it("shows the approval step only when there was one", () => {
    expect(swapTimeline(swap()).some((e) => /approved/i.test(e.label))).toBe(false);
    expect(
      swapTimeline(swap({ approvalTxHash: "0xdef" })).some((e) => /approved/i.test(e.label))
    ).toBe(true);
  });

  it("marks a refunded bridge leg as failed, not done", () => {
    const entries = swapTimeline(
      swap({ status: "failed", bridgeSubstatus: "REFUNDED", txHash: "0xabc" })
    );
    const bridgeLeg = entries[entries.length - 1];
    expect(bridgeLeg.state).toBe("failed");
    expect(bridgeLeg.label).toMatch(/refund/i);
  });
});

describe("describeSwap", () => {
  it("names both chains only when they differ", () => {
    expect(describeSwap(swap())).toContain("arbitrum → base");
    expect(describeSwap(swap({ toChain: "arbitrum" }))).toContain("on arbitrum");
  });
});

describe("explorer links", () => {
  const chains = [
    { id: "arbitrum", name: "Arbitrum One", chainId: 42161, explorer: "https://arbiscan.io" },
    { id: "base", name: "Base", chainId: 8453, explorer: "https://basescan.org/" },
  ];
  const hash = "0x" + "a".repeat(64);

  it("builds a tx link by slug or chainId", () => {
    expect(explorerTxUrl("arbitrum", hash, chains)).toBe(`https://arbiscan.io/tx/${hash}`);
    expect(explorerTxUrl(42161, hash, chains)).toBe(`https://arbiscan.io/tx/${hash}`);
  });

  it("does not double the slash on an explorer with a trailing one", () => {
    expect(explorerTxUrl("base", hash, chains)).toBe(`https://basescan.org/tx/${hash}`);
  });

  it("returns null rather than guessing an explorer", () => {
    // A link to the wrong chain shows "transaction not found" for a
    // transaction that exists, which reads as lost funds.
    expect(explorerTxUrl("robinhood", hash, chains)).toBeNull();
    expect(explorerTxUrl("arbitrum", null, chains)).toBeNull();
    expect(explorerTxUrl("arbitrum", "0xshort", chains)).toBeNull();
  });

  it("validates address shape too", () => {
    const address = "0x" + "1".repeat(40);
    expect(explorerAddressUrl("arbitrum", address, chains)).toBe(
      `https://arbiscan.io/address/${address}`
    );
    expect(explorerAddressUrl("arbitrum", hash, chains)).toBeNull(); // 32 bytes, not 20
  });

  it("falls back to the slug rather than inventing a name", () => {
    expect(chainName("arbitrum", chains)).toBe("Arbitrum One");
    expect(chainName("robinhood", chains)).toBe("robinhood");
    expect(chainName(9999, chains)).toBe("Chain 9999");
  });
});
