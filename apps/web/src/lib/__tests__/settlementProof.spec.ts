import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  verifyUsdcPayment,
  usdToAtomicUsdc,
  ERC20_TRANSFER_TOPIC,
} from "@/lib/travel/settlementProof";
import { USDC_ADDRESS } from "@/lib/services/usdcBalances";

// Mocks for viem
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(),
  };
});

import { createPublicClient, toHex, pad } from "viem";

describe("settlementProof — usdToAtomicUsdc", () => {
  it("converts USD amounts to exact 6-decimal atomic units without float truncation", () => {
    // 420.07 * 1e6 in pure float math is 420069999.99999994.
    // Our implementation must round to cents first: 420.07 -> 42007 cents -> 420070000 atomic.
    expect(usdToAtomicUsdc(420.07)).toBe("420070000");
    expect(usdToAtomicUsdc(1)).toBe("1000000");
    expect(usdToAtomicUsdc(0.01)).toBe("10000");
    expect(usdToAtomicUsdc(1500.5)).toBe("1500500000");
  });

  it("rejects negative, zero, and non-finite numbers", () => {
    expect(() => usdToAtomicUsdc(0)).toThrow();
    expect(() => usdToAtomicUsdc(-10)).toThrow();
    expect(() => usdToAtomicUsdc(NaN)).toThrow();
    expect(() => usdToAtomicUsdc(Infinity)).toThrow();
  });
});

describe("settlementProof — verifyUsdcPayment", () => {
  const VALID_TX = "0x" + "a".repeat(64);
  const OUR_TREASURY = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
  const OTHER_ADDR = "0x1111111111111111111111111111111111111111";
  const CANONICAL_BASE_USDC = USDC_ADDRESS.base;
  const FAKE_TOKEN_ADDR = "0x9999999999999999999999999999999999999999";

  const makeTopicAddress = (addr: string) => pad(addr.toLowerCase() as `0x${string}`, { size: 32 });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed transaction hash format", async () => {
    const res = await verifyUsdcPayment({
      txHash: "0x123",
      network: "base",
      expectedTo: OUR_TREASURY,
      expectedAtomic: "100000000",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("malformed_tx_hash");
  });

  it("rejects unsupported networks or solana via this EVM verifier", async () => {
    const res = await verifyUsdcPayment({
      txHash: VALID_TX,
      network: "solana",
      expectedTo: OUR_TREASURY,
      expectedAtomic: "100000000",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unsupported_network");
  });

  it("handles receipt lookup failure (e.g. pending in mempool)", async () => {
    const mockClient = {
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error("Transaction receipt not found")),
      getTransactionConfirmations: vi.fn(),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as any);

    const res = await verifyUsdcPayment({
      txHash: VALID_TX,
      network: "base",
      expectedTo: OUR_TREASURY,
      expectedAtomic: "100000000",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("tx_not_found");
  });

  it("rejects reverted transactions", async () => {
    const mockClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({ status: "reverted", logs: [] }),
      getTransactionConfirmations: vi.fn().mockResolvedValue(10n),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as any);

    const res = await verifyUsdcPayment({
      txHash: VALID_TX,
      network: "base",
      expectedTo: OUR_TREASURY,
      expectedAtomic: "100000000",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("tx_reverted");
  });

  it("REJECTS counterfeit tokens: transfer event emitted by wrong contract address", async () => {
    const mockClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        logs: [
          {
            address: FAKE_TOKEN_ADDR, // Attacker's own token!
            topics: [
              ERC20_TRANSFER_TOPIC,
              makeTopicAddress(OTHER_ADDR),
              makeTopicAddress(OUR_TREASURY),
            ],
            data: toHex(100_000_000n), // $100
          },
        ],
      }),
      getTransactionConfirmations: vi.fn().mockResolvedValue(10n),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as any);

    const res = await verifyUsdcPayment({
      txHash: VALID_TX,
      network: "base",
      expectedTo: OUR_TREASURY,
      expectedAtomic: "100000000",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no_matching_transfer");
  });

  it("REJECTS transfers sent to wrong recipient address", async () => {
    const mockClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        logs: [
          {
            address: CANONICAL_BASE_USDC,
            topics: [
              ERC20_TRANSFER_TOPIC,
              makeTopicAddress(OTHER_ADDR),
              makeTopicAddress(OTHER_ADDR), // Wrong recipient!
            ],
            data: toHex(100_000_000n),
          },
        ],
      }),
      getTransactionConfirmations: vi.fn().mockResolvedValue(10n),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as any);

    const res = await verifyUsdcPayment({
      txHash: VALID_TX,
      network: "base",
      expectedTo: OUR_TREASURY,
      expectedAtomic: "100000000",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no_matching_transfer");
  });

  it("REJECTS transfers with insufficient atomic value (underpayment)", async () => {
    const mockClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        logs: [
          {
            address: CANONICAL_BASE_USDC,
            topics: [
              ERC20_TRANSFER_TOPIC,
              makeTopicAddress(OTHER_ADDR),
              makeTopicAddress(OUR_TREASURY),
            ],
            data: toHex(99_999_999n), // 1 atomic unit short!
          },
        ],
      }),
      getTransactionConfirmations: vi.fn().mockResolvedValue(10n),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as any);

    const res = await verifyUsdcPayment({
      txHash: VALID_TX,
      network: "base",
      expectedTo: OUR_TREASURY,
      expectedAtomic: "100000000",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no_matching_transfer");
  });

  it("rejects transactions with insufficient confirmation depth as retryable", async () => {
    const mockClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        logs: [
          {
            address: CANONICAL_BASE_USDC,
            topics: [
              ERC20_TRANSFER_TOPIC,
              makeTopicAddress(OTHER_ADDR),
              makeTopicAddress(OUR_TREASURY),
            ],
            data: toHex(100_000_000n),
          },
        ],
      }),
      getTransactionConfirmations: vi.fn().mockResolvedValue(0n), // 0 confirmations
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as any);

    const res = await verifyUsdcPayment({
      txHash: VALID_TX,
      network: "base",
      expectedTo: OUR_TREASURY,
      expectedAtomic: "100000000",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("insufficient_confirmations");
      expect(res.confirmations).toBe(0);
      expect(res.requiredConfirmations).toBeGreaterThan(0);
    }
  });

  it("ACCEPTS genuine USDC payment with correct contract, recipient, amount, and depth", async () => {
    const mockClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        logs: [
          {
            address: CANONICAL_BASE_USDC,
            topics: [
              ERC20_TRANSFER_TOPIC,
              makeTopicAddress(OTHER_ADDR),
              makeTopicAddress(OUR_TREASURY),
            ],
            data: toHex(100_000_000n),
          },
        ],
      }),
      // 100_000_000 atomic = $100, and requiredConfirmations() demands 12 at
      // that value (>= $10 -> 12). Mocking 10 made this case fail for the
      // RIGHT reason: the verifier refused an under-confirmed payment.
      getTransactionConfirmations: vi.fn().mockResolvedValue(12n),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as any);

    const res = await verifyUsdcPayment({
      txHash: VALID_TX,
      network: "base",
      expectedTo: OUR_TREASURY,
      expectedAtomic: "100000000",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.txHash).toBe(VALID_TX);
      expect(res.network).toBe("base");
      expect(res.paidAtomic).toBe("100000000");
      expect(res.confirmations).toBe(12);
    }
  });
});
