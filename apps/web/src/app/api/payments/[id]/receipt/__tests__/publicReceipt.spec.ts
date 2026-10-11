import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// SEC-P3-003: the receipt is unauthenticated (a payment id is a capability
// link). It must not hand the link holder the payer identity or the
// merchant's free-form metadata, which publicPaymentView already withholds.

const RECORD = {
  id: "pay_0123456789abcdef01234567",
  status: "settled",
  settlementChain: "arbitrum",
  transactionHash: "0x" + "a".repeat(64),
  payer: "0x" + "1".repeat(40),
  recipient: "0x" + "2".repeat(40),
  amountUsdc: 25,
  feeUsdc: 0.13,
  settledAt: "2026-10-06T00:00:00.000Z",
  metadata: { customerEmail: "buyer@example.com", orderRef: "ORD-42" },
};

vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: async () => null }));
vi.mock("@/lib/services/payments", () => ({ getPayment: (id: string) => (id === RECORD.id ? RECORD : undefined) }));
vi.mock("@/lib/services/chainRegistry", () => ({ getChain: () => ({ name: "Arbitrum One", chainId: 42161, explorer: "https://arbiscan.io" }) }));

const { GET } = await import("../route");

describe("public payment receipt (SEC-P3-003)", () => {
  it("returns the settlement facts but not the payer or merchant metadata", async () => {
    const res = await GET(new NextRequest(`https://furlpay.com/api/payments/${RECORD.id}/receipt`), {
      params: Promise.resolve({ id: RECORD.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ paymentId: RECORD.id, status: "settled", recipient: RECORD.recipient, amountUsdc: "25.00" });
    expect(body).not.toHaveProperty("payer");
    expect(body).not.toHaveProperty("metadata");
    expect(JSON.stringify(body)).not.toContain("buyer@example.com");
  });
});
