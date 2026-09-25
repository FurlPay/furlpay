import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const getTransactionReceipt = vi.fn();
const getTransactionConfirmations = vi.fn();

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({ getTransactionReceipt, getTransactionConfirmations }),
  };
});

import { getAddress, keccak256, toHex, pad } from "viem";
import {
  ERC20_TRANSFER_TOPIC,
  usdToAtomicUsdc,
  verifyUsdcPayment,
} from "@/lib/travel/settlementProof";
import { ARC_SYSTEM_EMITTER, ARC_USDC_ERC20 } from "@/lib/chains/arc";
import { USDC_ADDRESS } from "@/lib/services/usdcBalances";

const BASE_USDC = getAddress(USDC_ADDRESS.base);
const PAY_TO = getAddress("0x209693Bc6afc0C5328bA36FaF03C514EF312287C");
const ATTACKER_TOKEN = getAddress("0x00000000000000000000000000000000DeaDBeef");
const SOMEONE_ELSE = getAddress("0x1111111111111111111111111111111111111111");
const TX = `0x${"ab".repeat(32)}`;

/** Build an ERC-20 Transfer log the way a chain would emit it. */
function transferLog(opts: { token: string; to: string; value: bigint; from?: string }) {
  return {
    address: opts.token,
    topics: [
      ERC20_TRANSFER_TOPIC,
      pad(getAddress(opts.from ?? SOMEONE_ELSE), { size: 32 }),
      pad(getAddress(opts.to), { size: 32 }),
    ],
    data: toHex(opts.value, { size: 32 }),
  };
}

function receiptWith(logs: unknown[], status: "success" | "reverted" = "success") {
  return { status, logs };
}

beforeEach(() => {
  getTransactionReceipt.mockReset();
  getTransactionConfirmations.mockReset();
  getTransactionConfirmations.mockResolvedValue(50n);
});

afterEach(() => vi.clearAllMocks());

describe("usdToAtomicUsdc", () => {
  it("converts without float drift", () => {
    // 420.07 * 1e6 === 420069999.99999994 in IEEE-754, which floors one unit
    // short and would fail an exact-amount comparison.
    expect(usdToAtomicUsdc(420.07)).toBe("420070000");
    expect(usdToAtomicUsdc(0.01)).toBe("10000");
    expect(usdToAtomicUsdc(1)).toBe("1000000");
    expect(usdToAtomicUsdc(1234.56)).toBe("1234560000");
  });

  it("rejects non-positive or non-finite amounts", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => usdToAtomicUsdc(bad)).toThrow();
    }
  });
});

describe("verifyUsdcPayment — input validation", () => {
  it("rejects a malformed tx hash without touching the network", async () => {
    const r = await verifyUsdcPayment({
      txHash: "0xnope",
      network: "base",
      expectedTo: PAY_TO,
      expectedAtomic: "1000000",
    });
    expect(r).toMatchObject({ ok: false, reason: "malformed_tx_hash" });
    expect(getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("rejects an unsupported network", async () => {
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "solana",
      expectedTo: PAY_TO,
      expectedAtomic: "1000000",
    });
    expect(r).toMatchObject({ ok: false, reason: "unsupported_network" });
  });
});

describe("verifyUsdcPayment — the forged-token attack", () => {
  it("REJECTS a perfect Transfer log emitted by an attacker's own token", async () => {
    // This is the whole point of the module. The attacker deploys a token,
    // mints themselves a billion units, and sends the exact expected amount to
    // the exact right address. The log is well-formed, the recipient is right,
    // the value is right — and it is worth nothing. Only pinning the emitting
    // contract catches it.
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: ATTACKER_TOKEN, to: PAY_TO, value: 500_000_000n })])
    );

    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "base",
      expectedTo: PAY_TO,
      expectedAtomic: "500000000",
    });
    expect(r).toMatchObject({ ok: false, reason: "no_matching_transfer" });
  });

  it("accepts the same transfer when it comes from the real USDC contract", async () => {
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: BASE_USDC, to: PAY_TO, value: 500_000_000n })])
    );

    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "base",
      expectedTo: PAY_TO,
      expectedAtomic: "500000000",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.paidAtomic).toBe("500000000");
  });
});

describe("verifyUsdcPayment — recipient and amount", () => {
  it("rejects a real USDC transfer sent to someone else", async () => {
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: BASE_USDC, to: SOMEONE_ELSE, value: 500_000_000n })])
    );
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "base",
      expectedTo: PAY_TO,
      expectedAtomic: "500000000",
    });
    expect(r).toMatchObject({ ok: false, reason: "no_matching_transfer" });
  });

  it("rejects an underpayment by a single atomic unit", async () => {
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: BASE_USDC, to: PAY_TO, value: 499_999_999n })])
    );
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "base",
      expectedTo: PAY_TO,
      expectedAtomic: "500000000",
    });
    expect(r).toMatchObject({ ok: false, reason: "no_matching_transfer" });
  });

  it("accepts an overpayment", async () => {
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: BASE_USDC, to: PAY_TO, value: 600_000_000n })])
    );
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "base",
      expectedTo: PAY_TO,
      expectedAtomic: "500000000",
    });
    expect(r.ok).toBe(true);
  });

  it("does NOT sum two smaller transfers into one payment", async () => {
    // Two unrelated $250 transfers are not a $500 payment. Summing them would
    // let an attacker combine someone else's transfer with a tiny one of
    // their own.
    getTransactionReceipt.mockResolvedValue(
      receiptWith([
        transferLog({ token: BASE_USDC, to: PAY_TO, value: 250_000_000n }),
        transferLog({ token: BASE_USDC, to: PAY_TO, value: 250_000_000n }),
      ])
    );
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "base",
      expectedTo: PAY_TO,
      expectedAtomic: "500000000",
    });
    expect(r).toMatchObject({ ok: false, reason: "no_matching_transfer" });
  });

  it("finds the matching transfer among unrelated logs", async () => {
    getTransactionReceipt.mockResolvedValue(
      receiptWith([
        transferLog({ token: ATTACKER_TOKEN, to: PAY_TO, value: 999_999_999n }),
        transferLog({ token: BASE_USDC, to: SOMEONE_ELSE, value: 10n }),
        { address: BASE_USDC, topics: [keccak256(toHex("Approval(address,address,uint256)"))], data: "0x" },
        transferLog({ token: BASE_USDC, to: PAY_TO, value: 500_000_000n }),
      ])
    );
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "base",
      expectedTo: PAY_TO,
      expectedAtomic: "500000000",
    });
    expect(r.ok).toBe(true);
  });
});

describe("verifyUsdcPayment — chain state", () => {
  it("rejects a reverted transaction", async () => {
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: BASE_USDC, to: PAY_TO, value: 500_000_000n })], "reverted")
    );
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "base",
      expectedTo: PAY_TO,
      expectedAtomic: "500000000",
    });
    expect(r).toMatchObject({ ok: false, reason: "tx_reverted" });
  });

  it("treats a missing receipt as retryable, not as failure", async () => {
    // Absence is not proof — the tx may still be in the mempool. Reporting
    // this as a hard failure would cancel bookings that are about to succeed.
    getTransactionReceipt.mockRejectedValue(new Error("not found"));
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "base",
      expectedTo: PAY_TO,
      expectedAtomic: "500000000",
    });
    expect(r).toMatchObject({ ok: false, reason: "tx_not_found" });
  });

  it("demands amount-scaled confirmation depth", async () => {
    // $500 -> requiredConfirmations() demands 12. An L2 reorg at 2
    // confirmations would leave us having issued an irreversible ticket.
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: BASE_USDC, to: PAY_TO, value: 500_000_000n })])
    );
    getTransactionConfirmations.mockResolvedValue(2n);

    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "base",
      expectedTo: PAY_TO,
      expectedAtomic: "500000000",
    });
    expect(r).toMatchObject({ ok: false, reason: "insufficient_confirmations", confirmations: 2 });
    if (!r.ok) expect(r.requiredConfirmations).toBe(12);
  });

  it("accepts once the depth is reached", async () => {
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: BASE_USDC, to: PAY_TO, value: 500_000_000n })])
    );
    getTransactionConfirmations.mockResolvedValue(12n);
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "base",
      expectedTo: PAY_TO,
      expectedAtomic: "500000000",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.confirmations).toBe(12);
  });
});

describe("verifyUsdcPayment — Arc dual emitter (EIP-7708)", () => {
  it("verifies a native Arc USDC payment emitted by the system emitter at 18 decimals", async () => {
    // $100 payment = 100_000_000 atomic units at 6dp -> 100_000_000_000_000_000_000n wei (18dp)
    const nativeVal = 100_000_000_000_000_000_000n;
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: ARC_SYSTEM_EMITTER, to: PAY_TO, value: nativeVal })])
    );
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "arc",
      expectedTo: PAY_TO,
      expectedAtomic: "100000000",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paidAtomic).toBe("100000000");
      expect(r.confirmations).toBe(50);
      expect(r.requiredConfirmations).toBe(1);
    }
  });

  it("rejects 10^12 under-accept hazard (100 atomic units wei cannot pay for 100 USDC)", async () => {
    // Attacker sends 100_000_000 wei ($0.0000001) instead of 100_000_000e12 wei ($100)
    const underpaymentWei = 100_000_000n;
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: ARC_SYSTEM_EMITTER, to: PAY_TO, value: underpaymentWei })])
    );
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "arc",
      expectedTo: PAY_TO,
      expectedAtomic: "100000000",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_matching_transfer");
  });

  it("still REFUSES a transaction with zero confirmations", async () => {
    // Arc finalises on inclusion, so the requirement is 1 rather than an
    // amount-scaled ladder — but 1 has to actually be checked. This branch used
    // to return ok:true while reporting requiredConfirmations: 1 without ever
    // comparing against it, so it could answer "proven, confirmations: 0,
    // required: 1" — a result that contradicts its own numbers.
    //
    // Zero confirmations means this node does not yet consider the transaction
    // to be in a canonical block. Arc's finality guarantee is about an INCLUDED
    // transaction; it is not a reason to skip checking inclusion, and an RPC
    // whose head is behind is the ordinary way this happens.
    const nativeVal = 100_000_000_000_000_000_000n;
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: ARC_SYSTEM_EMITTER, to: PAY_TO, value: nativeVal })])
    );
    getTransactionConfirmations.mockResolvedValue(0n);

    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "arc",
      expectedTo: PAY_TO,
      expectedAtomic: "100000000",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("insufficient_confirmations");
      expect(r.confirmations).toBe(0);
      expect(r.requiredConfirmations).toBe(1);
    }
  });

  it("accepts at exactly 1 confirmation, so the Arc requirement is not off by one", async () => {
    // The counterpart: the gate must not become a reason to wait on a chain
    // where waiting buys nothing. One confirmation is sufficient AND required.
    const nativeVal = 100_000_000_000_000_000_000n;
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: ARC_SYSTEM_EMITTER, to: PAY_TO, value: nativeVal })])
    );
    getTransactionConfirmations.mockResolvedValue(1n);

    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "arc",
      expectedTo: PAY_TO,
      expectedAtomic: "100000000",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.confirmations).toBe(1);
  });

  it("records the truncated 6dp figure when the native amount carries dust", async () => {
    // A native payment need not be a whole number of 6dp units. $100 plus
    // 662379335864 wei of sub-6dp dust — a real shape, measured on Arc mainnet.
    // paidAtomic must be the figure the ERC-20 interface could actually move,
    // and the dust must never be rounded UP into it: that would record a payment
    // larger than anything that can be transferred back out.
    const withDust = 100_000_000_000_000_000_000n + 662_379_335_864n;
    getTransactionReceipt.mockResolvedValue(
      receiptWith([transferLog({ token: ARC_SYSTEM_EMITTER, to: PAY_TO, value: withDust })])
    );
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "arc",
      expectedTo: PAY_TO,
      expectedAtomic: "100000000",
    });
    expect(r.ok).toBe(true);
    // Truncated, not rounded: still exactly $100.000000, never $100.000001.
    if (r.ok) expect(r.paidAtomic).toBe("100000000");
  });

  it("handles dual-emitter ERC-20 transfer without double-crediting", async () => {
    const nativeVal = 50_000_000_000_000_000_000n; // $50 in 18dp
    const erc20Val = 50_000_000n; // $50 in 6dp
    getTransactionReceipt.mockResolvedValue(
      receiptWith([
        transferLog({ token: ARC_SYSTEM_EMITTER, to: PAY_TO, value: nativeVal }),
        transferLog({ token: ARC_USDC_ERC20, to: PAY_TO, value: erc20Val }),
      ])
    );
    const r = await verifyUsdcPayment({
      txHash: TX,
      network: "arc",
      expectedTo: PAY_TO,
      expectedAtomic: "50000000",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paidAtomic).toBe("50000000");
      expect(r.requiredConfirmations).toBe(1);
    }
  });
});
