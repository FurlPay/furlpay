import { resumeOpenSwaps } from "../swap/resumeBridges";

// ---------------------------------------------------------------------------
// What happens to a bridge when the app is closed under it.
//
// This is the case the swap engine could not previously survive: funds have
// left the source chain, the destination transfer is minutes away, and the
// poller watching it died with the screen. On the next launch the reconciler
// has to re-read state from the network — because "we stopped watching" tells
// you nothing at all about the outcome.
//
// The distinctions pinned below are the ones a user would feel:
//   DONE + REFUNDED  is finished and NOT a success
//   NOT_FOUND        is "ask again", not "lost"
//   offline          is "ask again", not "failed"
// ---------------------------------------------------------------------------

jest.mock("@/lib/api", () => ({ api: jest.fn() }));
jest.mock("@/lib/evm/rpc", () => ({ getTransactionReceipt: jest.fn() }));
jest.mock("@/lib/swap/swapJournal", () => ({
  expireStaleSwaps: jest.fn(() => 0),
  listResumableSwaps: jest.fn(() => []),
  updateSwap: jest.fn(),
}));

const { api } = require("@/lib/api") as { api: jest.Mock };
const { getTransactionReceipt } = require("@/lib/evm/rpc") as { getTransactionReceipt: jest.Mock };
const journal = require("@/lib/swap/swapJournal") as {
  expireStaleSwaps: jest.Mock;
  listResumableSwaps: jest.Mock;
  updateSwap: jest.Mock;
};

function openBridge(overrides: Record<string, unknown> = {}) {
  return {
    id: "route-1",
    routeId: "route-1",
    status: "bridging",
    step: "bridging",
    fromChain: "arbitrum",
    toChain: "base",
    fromToken: "USDC",
    toToken: "USDC",
    amountIn: 100,
    amountOut: null,
    txHash: "0xsource",
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

beforeEach(() => {
  jest.clearAllMocks();
  journal.expireStaleSwaps.mockReturnValue(0);
  journal.listResumableSwaps.mockReturnValue([]);
});

describe("bridged routes", () => {
  it("settles a bridge that completed while the app was closed", async () => {
    journal.listResumableSwaps.mockReturnValue([openBridge()]);
    api.mockResolvedValue({
      status: "DONE",
      substatus: "COMPLETED",
      substatusMessage: null,
      receiving: "0xdest",
    });

    const outcome = await resumeOpenSwaps();

    expect(outcome.settled).toBe(1);
    expect(journal.updateSwap).toHaveBeenCalledWith(
      "route-1",
      expect.objectContaining({ status: "done", destTxHash: "0xdest" })
    );
  });

  it("records a refund as a failure, not a completed swap", async () => {
    journal.listResumableSwaps.mockReturnValue([openBridge()]);
    api.mockResolvedValue({
      status: "DONE",
      substatus: "REFUNDED",
      substatusMessage: null,
      receiving: null,
    });

    await resumeOpenSwaps();

    // DONE + REFUNDED is a finished bridge that gave the money back. Writing
    // "done" would tell the user they received something they did not.
    expect(journal.updateSwap).toHaveBeenCalledWith(
      "route-1",
      expect.objectContaining({ status: "failed" })
    );
  });

  it("leaves a still-pending bridge open for the next launch", async () => {
    journal.listResumableSwaps.mockReturnValue([openBridge()]);
    api.mockResolvedValue({
      status: "PENDING",
      substatus: "WAIT_DESTINATION_TRANSACTION",
      substatusMessage: null,
      receiving: null,
    });

    const outcome = await resumeOpenSwaps();

    expect(outcome.stillPending).toBe(1);
    expect(outcome.settled).toBe(0);
    expect(journal.updateSwap).toHaveBeenCalledWith(
      "route-1",
      expect.objectContaining({ status: "bridging" })
    );
  });

  it("treats NOT_FOUND as 'ask again', never as a loss", async () => {
    // The indexer simply has not seen the source transaction yet. Marking this
    // failed would report a loss that has not happened.
    journal.listResumableSwaps.mockReturnValue([openBridge()]);
    api.mockResolvedValue({
      status: "NOT_FOUND",
      substatus: null,
      substatusMessage: null,
      receiving: null,
    });

    const outcome = await resumeOpenSwaps();
    expect(outcome.stillPending).toBe(1);
  });

  it("leaves entries open when offline, rather than failing them", async () => {
    journal.listResumableSwaps.mockReturnValue([openBridge()]);
    api.mockRejectedValue(new Error("offline"));

    const outcome = await resumeOpenSwaps();

    expect(outcome.stillPending).toBe(1);
    // "We couldn't ask" is not "it failed".
    expect(journal.updateSwap).not.toHaveBeenCalled();
  });
});

describe("same-chain swaps", () => {
  const sameChain = () => openBridge({ toChain: "arbitrum", status: "pending" });

  it("reads the receipt instead of assuming success", async () => {
    journal.listResumableSwaps.mockReturnValue([sameChain()]);
    getTransactionReceipt.mockResolvedValue({ status: "0x1" });

    const outcome = await resumeOpenSwaps();

    expect(getTransactionReceipt).toHaveBeenCalledWith("arbitrum", "0xsource");
    expect(outcome.settled).toBe(1);
    expect(journal.updateSwap).toHaveBeenCalledWith(
      "route-1",
      expect.objectContaining({ status: "done" })
    );
    // A same-chain swap has no second leg — nothing to ask LI.FI about.
    expect(api).not.toHaveBeenCalled();
  });

  it("records a revert as failed", async () => {
    journal.listResumableSwaps.mockReturnValue([sameChain()]);
    getTransactionReceipt.mockResolvedValue({ status: "0x0" });

    await resumeOpenSwaps();

    expect(journal.updateSwap).toHaveBeenCalledWith(
      "route-1",
      expect.objectContaining({ status: "failed" })
    );
  });

  it("leaves an unmined transaction open", async () => {
    journal.listResumableSwaps.mockReturnValue([sameChain()]);
    getTransactionReceipt.mockResolvedValue(null); // not mined yet

    const outcome = await resumeOpenSwaps();

    expect(outcome.stillPending).toBe(1);
    expect(journal.updateSwap).not.toHaveBeenCalled();
  });
});

describe("robustness", () => {
  it("never throws — this runs during app start", async () => {
    journal.listResumableSwaps.mockImplementation(() => {
      throw new Error("database locked");
    });
    await expect(resumeOpenSwaps()).resolves.toBeDefined();
  });

  it("reports entries closed for age", async () => {
    journal.expireStaleSwaps.mockReturnValue(3);
    const outcome = await resumeOpenSwaps();
    // Left alone these would be retried on every launch forever.
    expect(outcome.expired).toBe(3);
  });
});
