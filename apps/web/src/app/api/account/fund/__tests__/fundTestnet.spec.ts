import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// SEC-P1-001: production must never credit spendable balance for a testnet
// settlement (faucet USDC is free). The refusal happens before settle(), so no
// testnet authorization is submitted.

const env = { financial: "production" as "production" | "staging" | "development" };
const settle = vi.fn(async () => ({ success: true, network: "arbitrum", payer: "0x" + "1".repeat(40), transaction: "0xtx" }));
const creditAccount = vi.fn(async () => ({ ok: true, balanceUsd: 10 }));

vi.mock("@/lib/flags", async (orig) => ({ ...(await orig<typeof import("@/lib/flags")>()), financialEnvironment: () => env.financial }));
vi.mock("@/lib/x402Facilitator", () => ({ settle }));
vi.mock("@/lib/services/account", () => ({ creditAccount }));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: () => {} }));
vi.mock("@/lib/authz", () => ({ optionalUser: async () => ({ kind: "user", account: { user: { id: "u-1" } } }) }));

const { POST } = await import("../route");
const { PAY_TO } = await import("@/lib/x402");

const fund = (network: string) =>
  POST(
    new NextRequest("https://furlpay.com/api/account/fund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentPayload: {
          x402Version: 1,
          scheme: "exact",
          network,
          payload: { signature: "0x", authorization: { from: "0x" + "1".repeat(40), to: PAY_TO, value: "10000000", validAfter: "0", validBefore: "9999999999", nonce: "0x" + "2".repeat(64) } },
        },
        paymentRequirements: { scheme: "exact", network, maxAmountRequired: "10000000", payTo: PAY_TO, asset: "0x" + "3".repeat(40), resource: "https://furlpay.com/fund" },
      }),
    }),
  );

beforeEach(() => {
  settle.mockClear();
  creditAccount.mockClear();
  env.financial = "production";
});

describe("account funding network (SEC-P1-001)", () => {
  it.each(["arbitrum-sepolia", "base-sepolia", "arc-testnet"])("production refuses %s before settling", async (network) => {
    const res = await fund(network);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("network_not_accepted");
    expect(settle).not.toHaveBeenCalled();
    expect(creditAccount).not.toHaveBeenCalled();
  });

  it("production refuses an unknown network", async () => {
    expect((await fund("not-a-chain")).status).toBe(400);
    expect(settle).not.toHaveBeenCalled();
  });

  it("production accepts a mainnet network", async () => {
    const res = await fund("arbitrum");
    expect(res.status).toBe(200);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(creditAccount).toHaveBeenCalledTimes(1);
  });

  it("staging may still fund from a testnet", async () => {
    env.financial = "staging";
    settle.mockResolvedValueOnce({ success: true, network: "arbitrum-sepolia", payer: "0x" + "1".repeat(40), transaction: "0xtx" });
    expect((await fund("arbitrum-sepolia")).status).toBe(200);
  });
});
