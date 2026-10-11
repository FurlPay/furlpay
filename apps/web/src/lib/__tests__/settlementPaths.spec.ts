import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Money paths outside the facilitator: the gasless route (FP-SET-08) and the
// compliance-guard wrapper/escrow writes (FP-SET-11). Real route and real
// store; only auth, attestation, signature verification and the signer are
// replaced.
// ---------------------------------------------------------------------------

const settler = vi.fn();
const gate = vi.fn();
const writeContract = vi.fn();

vi.mock("@/lib/authz", () => ({
  requireUser: async () => ({ ok: true, claims: { jti: "j" }, account: { user: { id: "user-1" } } }),
}));
vi.mock("@/lib/attestation", () => ({ requireMobileAttestation: async () => null }));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: async () => null }));
vi.mock("@/lib/ops/controls", () => ({ assertRailActive: async () => null, railPaused: async () => ({ paused: false }) }));
vi.mock("@/lib/ops/events", () => ({ recordTxEvent: vi.fn(), recordSecurityEvent: vi.fn() }));
vi.mock("@/lib/ops/overview", () => ({ recordRailHealth: vi.fn() }));
vi.mock("@/lib/x402Signature", async (orig) => ({
  ...(await orig<typeof import("@/lib/x402Signature")>()),
  verifyAuthorizationSignature: async () => ({ verified: true }),
}));
vi.mock("@/lib/x402Settler", async (orig) => ({
  ...(await orig<typeof import("@/lib/x402Settler")>()),
  defaultSettler: () => settler,
}));
vi.mock("@/lib/settlementGuard", () => ({ beforeBroadcast: (n: string) => gate(n) }));
vi.mock("@/lib/flags", async (orig) => ({
  ...(await orig<typeof import("@/lib/flags")>()),
  flagEnabled: () => true,
}));
vi.mock("viem", async (orig) => {
  const real = await orig<typeof import("viem")>();
  return {
    ...real,
    createWalletClient: () => ({ writeContract: (...a: unknown[]) => writeContract(...a) }),
  };
});

import { POST as gasless } from "@/app/api/transfers/gasless/route";
import { getSettlement, unresolvedSettlements } from "@/lib/x402SettlementStore";
import { SettlementPendingError } from "@/lib/x402Settler";
import { SettlementHaltedError } from "@/lib/settlementSafety";
import { GuardNotConfiguredError, resolveEscrow, settleWithPolicy } from "@/lib/complianceGuard";
import { NETWORK } from "@/lib/x402";

const TX = `0x${"c".repeat(64)}`;
let n = 0;
function gaslessReq() {
  const now = Math.floor(Date.now() / 1000);
  const nonce = `0x${(++n).toString(16).padStart(64, "0")}`;
  return new NextRequest("https://furlpay.com/api/transfers/gasless", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      signature: `0x${"1".repeat(130)}`,
      authorization: {
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        value: "1000000",
        validAfter: String(now - 60),
        validBefore: String(now + 600),
        nonce,
      },
    }),
  });
}

beforeEach(() => {
  (globalThis as unknown as { __furlpayKv?: Map<string, unknown> }).__furlpayKv?.clear();
  settler.mockReset();
  gate.mockReset().mockResolvedValue(undefined);
  writeContract.mockReset();
  vi.stubEnv("INTEGRATION_MODE", "live");
});
afterEach(() => vi.unstubAllEnvs());

describe("FP-SET-08: gasless transfers are visible to reconciliation", () => {
  it("a confirmed transfer is recorded confirmed in the settlement store", async () => {
    settler.mockResolvedValue({ transaction: TX, confirmations: 3 });
    const res = await gasless(gaslessReq());
    expect(res.status).toBe(200);
    expect((await getSettlement(TX))?.status).toBe("confirmed");
    expect(await unresolvedSettlements(NETWORK)).toEqual([]);
  });

  it("a pending transfer is recorded pending, so its status path no longer 404s and it blocks recovery", async () => {
    settler.mockRejectedValue(new SettlementPendingError(TX as `0x${string}`, NETWORK, "timeout"));
    const res = await gasless(gaslessReq());
    expect(res.status).toBe(202);
    expect((await getSettlement(TX))?.status).toBe("pending");
    expect(await unresolvedSettlements(NETWORK)).toEqual([TX]);
  });

  it("a breaker refusal is a 503 with nothing recorded (nothing was sent)", async () => {
    settler.mockRejectedValue(new SettlementHaltedError("global", "HALTED (manual_halt)"));
    const res = await gasless(gaslessReq());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("settlement_halted");
    expect(await getSettlement(TX)).toBeUndefined();
  });
});

describe("FP-SET-11: compliance-guard money writes pass the settlement gate", () => {
  const AUTH = { value: 1n, validAfter: 0n, validBefore: 9n, nonce: `0x${"0".repeat(64)}` as `0x${string}`, v: 27, r: `0x${"0".repeat(64)}` as `0x${string}`, s: `0x${"0".repeat(64)}` as `0x${string}` };
  const params = { from: "0x1111111111111111111111111111111111111111" as const, to: "0x2222222222222222222222222222222222222222" as const, auth: AUTH, resource: "r", txId: `0x${"0".repeat(64)}` as `0x${string}` };

  beforeEach(() => {
    vi.stubEnv("FURLPAY_POLICY_WRAPPER_ADDRESS", "0x3333333333333333333333333333333333333333");
    vi.stubEnv("FURLPAY_COMPLIANCE_ESCROW_ADDRESS", "0x4444444444444444444444444444444444444444");
    // A well-known test key (hardhat account 0) — never a real secret.
    vi.stubEnv("FURLPAY_RELAYER_PRIVATE_KEY", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    vi.stubEnv("FURLPAY_ENV", "staging");
  });

  it("a halted gate stops settleWithPolicy and resolveEscrow before anything is signed", async () => {
    gate.mockRejectedValue(new SettlementHaltedError("network:arbitrum", "HALTED"));
    await expect(settleWithPolicy(params)).rejects.toBeInstanceOf(SettlementHaltedError);
    await expect(resolveEscrow(params.txId, "release")).rejects.toBeInstanceOf(SettlementHaltedError);
    expect(writeContract).not.toHaveBeenCalled();
    expect(gate).toHaveBeenCalledWith("arbitrum");
  });

  it("refuses a raw relayer key in production, before the gate or the signer", async () => {
    vi.stubEnv("FURLPAY_ENV", "production");
    await expect(settleWithPolicy(params)).rejects.toBeInstanceOf(GuardNotConfiguredError);
    expect(gate).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });
});
