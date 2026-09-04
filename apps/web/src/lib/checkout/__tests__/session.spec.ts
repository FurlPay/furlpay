import { describe, it, expect, beforeEach } from "vitest";
import {
  canTransition,
  createSession,
  formatAtomic,
  getSession,
  isTerminal,
  recordSettlement,
  toAtomic,
  toPublic,
  transition,
  type CheckoutSession,
} from "../session";

// ---------------------------------------------------------------------------
// Checkout sessions.
//
// THE DEFECT THIS SUITE PINS. The previous route returned, for every request:
//
//     status: "complete",
//     transactionHash: "0x" + crypto.randomBytes(32).toString("hex"),
//
// A fabricated blockchain reference and a completed status for a payment that
// had not happened. The published @furlpay/elements button fed that hash into
// a merchant's onSuccess callback, so a merchant would ship goods against it.
//
// Every test here exists to make that class of failure unrepresentable rather
// than merely fixed.
// ---------------------------------------------------------------------------

const MERCHANT = "pk_test_merchantkeyid00";

beforeEach(() => {
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
});

const newSession = () =>
  createSession({
    merchantKeyId: MERCHANT,
    amountAtomic: "25000000", // $25.00 at 6dp
    decimals: 6,
    currency: "USD",
    token: "USDC",
  });

describe("a new session is never already paid", () => {
  it("starts at requires_payment with no transaction reference", async () => {
    const s = await newSession();
    // THE HEADLINE ASSERTION. There is no input that produces a paid session.
    expect(s.status).toBe("requires_payment");
    expect(s.transactionHash).toBeNull();
    expect(s.confirmations).toBeNull();
  });

  it("never emits a fabricated hash over the wire", async () => {
    const body = JSON.stringify(toPublic(await newSession()));
    expect(body).not.toMatch(/0x[0-9a-f]{64}/i);
    expect(body).not.toContain('"complete"');
  });

  it("gives each session a distinct id", async () => {
    const a = await newSession();
    const b = await newSession();
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith("cs_")).toBe(true);
  });

  it("persists, so status can actually be polled", async () => {
    // The old route stored nothing, so its "complete" could never be checked
    // against anything.
    const s = await newSession();
    const read = await getSession(s.id);
    expect(read?.id).toBe(s.id);
  });

  it("returns null for an unknown id rather than inventing one", async () => {
    expect(await getSession("cs_does_not_exist")).toBeNull();
  });
});

describe("settlement evidence cannot be fabricated", () => {
  it("refuses to record settlement without a transaction reference", async () => {
    const s = await newSession();
    await expect(
      recordSettlement(s, {
        transactionHash: "",
        network: "arbitrum:mainnet",
        confirmations: 3,
        requiredConfirmations: 3,
        finalized: false,
      })
    ).rejects.toThrow(/requires an observed transaction/i);
  });

  it("cannot jump from created straight to completed", async () => {
    // The only path to `completed` runs through observed evidence.
    const s = await newSession();
    await expect(transition(s, "completed")).rejects.toThrow(/illegal checkout transition/);
  });

  it("records a real reference and lands on the right state", async () => {
    const s = await newSession();
    const settled = await recordSettlement(s, {
      transactionHash: "0xabc123",
      network: "arbitrum:mainnet",
      confirmations: 5,
      requiredConfirmations: 3,
      finalized: false,
    });
    expect(settled.status).toBe("confirmed");
    expect(settled.transactionHash).toBe("0xabc123");
    expect(settled.network).toBe("arbitrum:mainnet");
  });

  it("stays in confirming while below the required depth", async () => {
    const s = await newSession();
    const settled = await recordSettlement(s, {
      transactionHash: "0xabc123",
      network: "base:mainnet",
      confirmations: 1,
      requiredConfirmations: 6,
      finalized: false,
    });
    // Not "confirmed" — the settlement policy asked for more than the chain
    // has given, and calling it confirmed anyway is the original defect in
    // miniature.
    expect(settled.status).toBe("confirming");
  });

  it("reaches finalized only when the chain's own rule is satisfied", async () => {
    const s = await newSession();
    const settled = await recordSettlement(s, {
      transactionHash: "0xabc123",
      network: "solana:mainnet-beta",
      confirmations: 32,
      requiredConfirmations: 32,
      finalized: true,
    });
    expect(settled.status).toBe("finalized");
  });

  it("refuses to overwrite a transaction reference with a different one", async () => {
    // A second reference is a second payment. Overwriting would destroy the
    // evidence a retry needs in order not to pay twice.
    const s = await newSession();
    const first = await recordSettlement(s, {
      transactionHash: "0xaaa",
      network: "base:mainnet",
      confirmations: 6,
      requiredConfirmations: 6,
      finalized: false,
    });
    await expect(
      transition(first, "finalized", { transactionHash: "0xbbb" })
    ).rejects.toThrow(/refusing to overwrite/i);
  });
});

describe("UNKNOWN is not FAILED", () => {
  it("can be reached from every in-flight state", () => {
    for (const from of ["submitted", "confirming", "confirmed", "finalized"] as const) {
      expect(canTransition(from, "unknown"), from).toBe(true);
    }
  });

  it("can be resolved forward once evidence arrives", () => {
    // A timeout is the absence of evidence, not evidence of failure. Later
    // evidence must be able to resolve it in either direction.
    expect(canTransition("unknown", "confirmed")).toBe(true);
    expect(canTransition("unknown", "failed")).toBe(true);
  });

  it("cannot become completed without first establishing what happened", () => {
    expect(canTransition("unknown", "completed")).toBe(false);
  });

  it("is not terminal", () => {
    expect(isTerminal("unknown")).toBe(false);
    expect(isTerminal("failed")).toBe(true);
  });
});

describe("expiry", () => {
  it("expires an unpaid session on read, with no sweeper running", async () => {
    const s = await createSession({
      merchantKeyId: MERCHANT,
      amountAtomic: "1000000",
      decimals: 6,
      currency: "USD",
      token: "USDC",
      ttlSeconds: 0.05,
    });
    await new Promise((r) => setTimeout(r, 80));
    const read = await getSession(s.id);
    expect(read?.status).toBe("expired");
  });

  it("does NOT expire a session that already has a payment in flight", async () => {
    // Expiring a submitted payment would abandon money that is already moving.
    const s = await createSession({
      merchantKeyId: MERCHANT,
      amountAtomic: "1000000",
      decimals: 6,
      currency: "USD",
      token: "USDC",
      ttlSeconds: 0.05,
    });
    await recordSettlement(s, {
      transactionHash: "0xabc",
      network: "base:mainnet",
      confirmations: 1,
      requiredConfirmations: 6,
      finalized: false,
    });
    await new Promise((r) => setTimeout(r, 80));
    const read = await getSession(s.id);
    expect(read?.status).toBe("confirming");
  });

  it("refuses payment on an expired session", () => {
    expect(canTransition("expired", "submitted")).toBe(false);
  });
});

describe("money handling", () => {
  it("converts major units to atomic without floating point", () => {
    expect(toAtomic("25.00", 6)).toBe("25000000");
    expect(toAtomic("0.000001", 6)).toBe("1");
    expect(toAtomic("1", 6)).toBe("1000000");
  });

  it("rejects excess precision rather than truncating money away", () => {
    // 0.0000001 USDC is not zero — it is an amount this asset cannot express,
    // and silently rounding it is how a merchant is underpaid.
    expect(() => toAtomic("0.0000001", 6)).toThrow(/decimal places/);
  });

  it("formats atomic units exactly beyond 2^53", () => {
    expect(formatAtomic("9007199254740993", 6)).toBe("9007199254.740993");
  });

  it("round-trips", () => {
    for (const v of ["0.000001", "25.000000", "1000000.500000"]) {
      expect(formatAtomic(toAtomic(v, 6), 6)).toBe(v);
    }
  });
});

describe("terminal states are terminal", () => {
  it("allows nothing out of completed, cancelled or failed", () => {
    for (const t of ["completed", "cancelled", "failed", "expired"] as const) {
      expect(isTerminal(t)).toBe(true);
      for (const to of ["submitted", "confirmed", "completed"] as const) {
        expect(canTransition(t, to), `${t} -> ${to}`).toBe(false);
      }
    }
  });
});
