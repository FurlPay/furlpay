import { executeSwap, SwapFailed, type SwapStep } from "../swap/executeSwap";

// ---------------------------------------------------------------------------
// The on-chain swap's ORDER, which is the part that costs money when wrong.
//
// Three orderings are load-bearing and none of them are enforced by types:
//
//   * the balance check happens BEFORE the biometric — otherwise the user
//     authorises a transaction that reverts out-of-funds and pays gas for the
//     privilege;
//   * the approval is WAITED ON before the swap is broadcast — a swap that
//     front-runs its own approval reverts;
//   * an allowance that already covers the amount produces NO approval — an
//     extra prompt for nothing is how people learn to approve reflexively.
//
// Everything below the API boundary is mocked, so these assert sequencing, not
// cryptography. RLP and EIP-1559 correctness are pinned separately against
// spec-derived vectors in evmRlp / evmTransaction.
// ---------------------------------------------------------------------------

jest.mock("../api", () => ({
  api: jest.fn(),
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {},
}));
jest.mock("../wallet", () => ({
  addressForSigning: jest.fn(),
  signTransaction: jest.fn(),
  hasWallet: jest.fn(),
}));
jest.mock("../evm/rpc", () => ({
  ...jest.requireActual("../evm/rpc"),
  getTransactionCount: jest.fn(),
  getFeeCaps: jest.fn(),
  getBalance: jest.fn(),
  estimateGas: jest.fn(),
  sendRawTransaction: jest.fn(),
  waitForReceipt: jest.fn(),
  call: jest.fn(),
}));

const { api } = require("../api") as { api: jest.Mock };
const wallet = require("../wallet") as {
  addressForSigning: jest.Mock;
  signTransaction: jest.Mock;
  hasWallet: jest.Mock;
};
const rpc = require("../evm/rpc") as Record<string, jest.Mock>;

const FROM = "0x1111111111111111111111111111111111111111";
const TOKEN = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // native USDC on Arbitrum
const ROUTER = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae"; // Li.Fi diamond

/** One million atomic units = 1.0 USDC (6dp). */
const ATOMIC = "1000000";

function plan(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    quote: { fromToken: "USDC", toToken: "DAI", fromChain: "arbitrum", toChain: "arbitrum", amountIn: 1, amountOut: 0.99 },
    approvalAddress: ROUTER,
    fromTokenAddress: TOKEN,
    fromAmountAtomic: ATOMIC,
    fromTokenDecimals: 6,
    toAmountMin: "990000",
    slippage: 0.001,
    routeId: "route-1",
    builtAt: new Date().toISOString(),
    // Stamped by our server — Li.Fi /v1/quote carries no expiry.
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    transactionRequest: {
      to: ROUTER,
      data: "0xdeadbeef",
      value: "0x0",
      chainId: 42161,
      gasLimit: "0x31a671",
    },
    ...overrides,
  };
}

/** An allowance return value, ABI-encoded as a 32-byte word. */
const allowanceOf = (value: bigint) => "0x" + value.toString(16).padStart(64, "0");

beforeEach(() => {
  jest.clearAllMocks();
  wallet.addressForSigning.mockResolvedValue(FROM);
  // DeviceKeySigner checks this before touching the key.
  wallet.hasWallet.mockResolvedValue(true);
  wallet.signTransaction.mockResolvedValue({ raw: "0x02aa", hash: "0xtx", from: FROM });
  rpc.getTransactionCount.mockResolvedValue(1n);
  rpc.getFeeCaps.mockResolvedValue({ maxFeePerGas: 100n, maxPriorityFeePerGas: 1n });
  rpc.getBalance.mockResolvedValue(10n ** 18n); // plenty
  rpc.estimateGas.mockResolvedValue(100_000n);
  rpc.sendRawTransaction.mockResolvedValue("0xtx");
  rpc.waitForReceipt.mockResolvedValue({ status: "0x1" } as never);
  api.mockResolvedValue(plan());
});

const params = {
  fromToken: "USDC" as const,
  toToken: "DAI" as const,
  fromChain: "arbitrum" as const,
  amountIn: 1,
};

describe("approval", () => {
  it("skips the approval when the allowance already covers the amount", async () => {
    rpc.call.mockResolvedValue(allowanceOf(10n ** 12n));
    const steps: SwapStep[] = [];

    await executeSwap({ ...params, onProgress: (p) => steps.push(p.step) });

    expect(steps).not.toContain("awaiting-approval-signature");
    // One signature and one broadcast: the swap itself.
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it("approves exactly the route's amount when the allowance is short", async () => {
    rpc.call.mockResolvedValue(allowanceOf(0n));
    await executeSwap(params);

    expect(wallet.signTransaction).toHaveBeenCalledTimes(2); // approval, then swap
    const approvalTx = wallet.signTransaction.mock.calls[0][0];
    expect(approvalTx.to).toBe(TOKEN); // the token, not the router
    expect(approvalTx.value).toBe(0n);
    // approve(spender, amount) — the exact atomic amount, not uint256 max.
    expect(approvalTx.data).toContain(ROUTER.slice(2));
    expect(BigInt("0x" + approvalTx.data.slice(-64))).toBe(BigInt(ATOMIC));
  });

  it("waits for the approval receipt before broadcasting the swap", async () => {
    rpc.call.mockResolvedValue(allowanceOf(0n));
    const order: string[] = [];
    rpc.sendRawTransaction.mockImplementation(async () => {
      order.push("broadcast");
      return "0xtx";
    });
    rpc.waitForReceipt.mockImplementation(async () => {
      order.push("receipt");
      return { status: "0x1" } as never;
    });

    await executeSwap(params);

    // A swap broadcast before its approval confirms reverts, and the user pays.
    expect(order).toEqual(["broadcast", "receipt", "broadcast", "receipt"]);
  });

  it("stops if the approval reverts, without broadcasting the swap", async () => {
    rpc.call.mockResolvedValue(allowanceOf(0n));
    rpc.waitForReceipt.mockResolvedValueOnce({ status: "0x0" } as never);

    await expect(executeSwap(params)).rejects.toMatchObject({
      step: "confirming-approval",
    });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1); // approval only
  });

  it("refuses a route that needs approval but names no token", async () => {
    api.mockResolvedValue(plan({ fromTokenAddress: null }));
    await expect(executeSwap(params)).rejects.toBeInstanceOf(SwapFailed);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it("skips allowance entirely for a native-token sell", async () => {
    api.mockResolvedValue(plan({ approvalAddress: null }));
    await executeSwap(params);
    expect(rpc.call).not.toHaveBeenCalled();
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("funds", () => {
  it("refuses before the biometric when the balance can't cover gas", async () => {
    rpc.call.mockResolvedValue(allowanceOf(10n ** 12n));
    rpc.getBalance.mockResolvedValue(1n); // nowhere near gasLimit × maxFeePerGas

    await expect(executeSwap(params)).rejects.toThrow(/balance/i);
    // The point of the ordering: no prompt, no broadcast, no wasted gas.
    expect(wallet.signTransaction).not.toHaveBeenCalled();
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe("failures", () => {
  it("reports a declined biometric without broadcasting", async () => {
    rpc.call.mockResolvedValue(allowanceOf(10n ** 12n));
    wallet.signTransaction.mockRejectedValue(new Error("User canceled"));

    await expect(executeSwap(params)).rejects.toMatchObject({
      step: "awaiting-swap-signature",
    });
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("carries the tx hash once the swap is public", async () => {
    rpc.call.mockResolvedValue(allowanceOf(10n ** 12n));
    rpc.waitForReceipt.mockResolvedValue({ status: "0x0" } as never); // reverted

    // Past broadcast, every failure must carry the hash — the transaction
    // exists whatever the app says next.
    await expect(executeSwap(params)).rejects.toMatchObject({
      step: "confirming",
      txHash: "0xtx",
    });
  });

  it("refuses when the device has no wallet", async () => {
    wallet.hasWallet.mockResolvedValue(false);
    wallet.addressForSigning.mockResolvedValue(null);
    await expect(executeSwap(params)).rejects.toThrow(/wallet/i);
    expect(api).not.toHaveBeenCalled();
  });

  it("sends the signer's own address as fromAddress", async () => {
    rpc.call.mockResolvedValue(allowanceOf(10n ** 12n));
    await executeSwap(params);
    expect(api.mock.calls[0][1].body.fromAddress).toBe(FROM);
  });
});

describe("pre-sign validation", () => {
  beforeEach(() => rpc.call.mockResolvedValue(allowanceOf(10n ** 12n)));

  it("refuses a route built for a different chain", async () => {
    // Base's chainId on an Arbitrum swap. The address exists on both chains, so
    // signing this would produce a live transaction the user never chose.
    api.mockResolvedValue(
      plan({ transactionRequest: { ...plan().transactionRequest, chainId: 8453 } })
    );
    await expect(executeSwap(params)).rejects.toThrow(/chain/i);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it("refuses a stale route rather than signing old calldata", async () => {
    api.mockResolvedValue(plan({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await expect(executeSwap(params)).rejects.toThrow(/expired/i);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it("refuses a route with no expiry — absence is not a guarantee", async () => {
    api.mockResolvedValue(plan({ expiresAt: undefined }));
    await expect(executeSwap(params)).rejects.toThrow(/re-quote/i);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it("refuses malformed calldata and malformed targets", async () => {
    for (const tr of [
      { data: "0x" },
      { to: "0xnot-an-address" },
      { to: "0x" + "0".repeat(40) },
    ]) {
      jest.clearAllMocks();
      rpc.call.mockResolvedValue(allowanceOf(10n ** 12n));
      api.mockResolvedValue(plan({ transactionRequest: { ...plan().transactionRequest, ...tr } }));
      await expect(executeSwap(params)).rejects.toBeInstanceOf(SwapFailed);
      expect(wallet.signTransaction).not.toHaveBeenCalled();
    }
  });
});

describe("broadcast integrity", () => {
  it("refuses to track a hash the node reports differently from the one signed", async () => {
    rpc.call.mockResolvedValue(allowanceOf(10n ** 12n));
    // Polling someone else's hash would report a stranger's outcome as the
    // user's.
    rpc.sendRawTransaction.mockResolvedValue("0xsomeoneelse");

    await expect(executeSwap(params)).rejects.toThrow(/different transaction/i);
  });
});

describe("signer injection", () => {
  /** Stands in for a Ledger/Tangem plugin without needing the hardware. */
  function hardwareSigner(chainIds: number[] | "all" = "all") {
    return {
      kind: "ledger" as const,
      label: "Ledger Nano X",
      capabilities: () => ({
        trustedDisplay: true,
        clearSigning: true,
        eip712: true,
        eip1559: true,
        prehashedOnly: false,
        presence: "button" as const,
        supportedChainIds: chainIds,
      }),
      getAddress: async () => FROM,
      signTransaction: jest.fn(async () => ({ raw: "0x02ff", hash: "0xtx", from: FROM })),
    };
  }

  it("signs with the injected signer, not the on-device key", async () => {
    rpc.call.mockResolvedValue(allowanceOf(10n ** 12n));
    const ledger = hardwareSigner();

    await executeSwap({ ...params, signer: ledger });

    // The whole point of the abstraction: the swap engine did not change, and
    // the device key was never touched.
    expect(ledger.signTransaction).toHaveBeenCalledTimes(1);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it("uses the injected signer for the approval too", async () => {
    rpc.call.mockResolvedValue(allowanceOf(0n));
    const ledger = hardwareSigner();

    await executeSwap({ ...params, signer: ledger });

    // Approval and swap are two transactions and both belong to the same
    // signer — splitting them across devices would approve from one account
    // and spend from another.
    expect(ledger.signTransaction).toHaveBeenCalledTimes(2);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it("refuses a chain the signer's firmware doesn't support, before quoting", async () => {
    // Arbitrum is 42161; this signer only knows mainnet.
    const limited = hardwareSigner([1]);

    await expect(executeSwap({ ...params, signer: limited })).rejects.toThrow(/cannot sign/i);
    // Refused before the route is even built — an unsupported chain costs
    // nothing and prompts for nothing.
    expect(api).not.toHaveBeenCalled();
    expect(limited.signTransaction).not.toHaveBeenCalled();
  });

  it("falls back to the on-device key when no signer is named", async () => {
    rpc.call.mockResolvedValue(allowanceOf(10n ** 12n));
    await executeSwap(params);
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("bridged routes", () => {
  const bridged = () =>
    plan({
      quote: {
        fromToken: "USDC",
        toToken: "USDC",
        fromChain: "arbitrum",
        toChain: "base",
        amountIn: 1,
        amountOut: 0.99,
      },
    });

  it("keeps tracking after the source receipt until the destination lands", async () => {
    rpc.call.mockResolvedValue(allowanceOf(10n ** 12n));
    api.mockImplementation(async (path: string) => {
      if (path.startsWith("/swaps/status")) {
        return { status: "DONE", substatus: "COMPLETED", receiving: "0xdest" };
      }
      return bridged();
    });

    const steps: SwapStep[] = [];
    await executeSwap({ ...params, toChain: "base", onProgress: (p) => steps.push(p.step) });

    // A source-chain receipt is NOT arrival on a bridged route.
    expect(steps).toContain("bridging");
    expect(steps[steps.length - 1]).toBe("done");
  });

  it("reports a refund as a failure, not a success", async () => {
    rpc.call.mockResolvedValue(allowanceOf(10n ** 12n));
    api.mockImplementation(async (path: string) => {
      if (path.startsWith("/swaps/status")) {
        // DONE + REFUNDED is "finished" and emphatically not "succeeded".
        return { status: "DONE", substatus: "REFUNDED", receiving: null };
      }
      return bridged();
    });

    await expect(executeSwap({ ...params, toChain: "base" })).rejects.toMatchObject({
      step: "bridging",
      txHash: "0xtx",
    });
  });

  it("does not poll the bridge for a same-chain swap", async () => {
    rpc.call.mockResolvedValue(allowanceOf(10n ** 12n));
    await executeSwap(params);
    expect(api.mock.calls.some(([path]) => String(path).startsWith("/swaps/status"))).toBe(false);
  });
});
