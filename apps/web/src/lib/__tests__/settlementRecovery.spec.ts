import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionReceiptNotFoundError } from "viem";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  receipt: vi.fn(), confirmations: vi.fn(), verify: vi.fn(),
  getSettlement: vi.fn(), recordSettlement: vi.fn(),
}));
vi.mock("viem", async (original) => ({
  ...await original<typeof import("viem")>(),
  createPublicClient: () => ({ getTransactionReceipt: mocks.receipt, getTransactionConfirmations: mocks.confirmations }),
}));
vi.mock("@/lib/settlementGuard", () => ({ afterReceipt: mocks.verify, beforeBroadcast: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: async () => null }));
vi.mock("@/lib/x402SettlementStore", () => ({
  getSettlement: mocks.getSettlement,
  recordSettlement: mocks.recordSettlement,
  pendingExpired: () => true,
  PENDING_TIMEOUT_MS: 900_000,
}));

import { checkSettlementOnChain } from "@/lib/x402Settler";
import { GET } from "@/app/api/x402/settlement/[tx]/route";

const tx = `0x${"a".repeat(64)}` as const;
const expected = {
  token: `0x${"1".repeat(40)}`, from: `0x${"2".repeat(40)}`,
  to: `0x${"3".repeat(40)}`, valueAtomic: "1000000", nonce: `0x${"4".repeat(64)}`,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.receipt.mockResolvedValue({ status: "success", logs: [] });
  mocks.confirmations.mockResolvedValue(100n);
  mocks.verify.mockResolvedValue(undefined);
  mocks.getSettlement.mockResolvedValue({
    transaction: tx, network: "arbitrum", status: "pending", amountAtomic: "1000000",
    settledAt: "2026-01-01T00:00:00.000Z", expectedTransfer: expected,
  });
});

describe("settlement recovery evidence", () => {
  it("distinguishes an explicit absent receipt from a provider failure", async () => {
    mocks.receipt.mockRejectedValueOnce(new TransactionReceiptNotFoundError({ hash: tx }));
    expect(await checkSettlementOnChain(tx, "arbitrum", expected)).toMatchObject({ found: false });
    mocks.receipt.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(checkSettlementOnChain(tx, "arbitrum", expected)).rejects.toThrow("provider unavailable");
  });

  it("requires the stored transfer before claiming receipt verification", async () => {
    expect(await checkSettlementOnChain(tx, "arbitrum")).toMatchObject({ receiptVerified: false });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(await checkSettlementOnChain(tx, "arbitrum", expected)).toMatchObject({ receiptVerified: true });
    expect(mocks.verify).toHaveBeenCalledWith("arbitrum", [], expect.objectContaining({ value: 1_000_000n }), tx);
  });

  it("does not abandon an expired pending payment during an RPC outage", async () => {
    mocks.receipt.mockRejectedValueOnce(new Error("provider unavailable"));
    const response = await GET(new NextRequest(`https://furlpay.com/api/x402/settlement/${tx}`), { params: Promise.resolve({ tx }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ pending: true, settled: false });
    expect(mocks.recordSettlement).not.toHaveBeenCalled();
  });
});
