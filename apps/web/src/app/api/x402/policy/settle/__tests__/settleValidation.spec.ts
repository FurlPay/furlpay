import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Boundary validation for the operator settle route (2026-10-02). The body was
// hand-parsed: `releaseDeadline` went through BigInt(), which reads "" as 0n,
// and nonce/r/s/v reached the contract call unchecked.

const settleTranche = vi.fn();
const settleWithPolicy = vi.fn();
vi.mock("@/lib/complianceGuard", async (orig) => ({
  ...(await orig<typeof import("@/lib/complianceGuard")>()),
  settleTranche,
  settleWithPolicy,
  readAttestation: vi.fn(async () => ({})),
}));

const { POST } = await import("../route");

const TOKEN = "operator-test-token";
const H32 = `0x${"ab".repeat(32)}`;
const ADDR_A = "0x52908400098527886E0F7030069857D2E4169EE7";
const ADDR_B = "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
const auth = { value: "1000000", validAfter: "0", validBefore: "9999999999", nonce: H32, v: 27, r: H32, s: H32 };

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/x402/policy/settle", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.stubEnv("FURLPAY_COMPLIANCE_OPERATOR_TOKEN", TOKEN);
  settleTranche.mockReset();
  settleWithPolicy.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const tranche = { mode: "tranche", from: ADDR_A, to: ADDR_B, txId: H32, compliantAuth: auth, escrowAuth: auth };

describe("x402 policy settle validates at the boundary", () => {
  it.each(["", "0", "0x10", "-5", " 7"])("refuses releaseDeadline %j (was BigInt-coerced)", async (releaseDeadline) => {
    const res = await post({ ...tranche, releaseDeadline });
    expect(res.status).toBe(400);
    expect(settleTranche).not.toHaveBeenCalled();
  });

  it("refuses a malformed signature field before any contract call", async () => {
    for (const bad of [{ nonce: "0x1" }, { r: "zz" }, { v: 5 }]) {
      const res = await post({ mode: "single", from: ADDR_A, to: ADDR_B, txId: H32, auth: { ...auth, ...bad } });
      expect(res.status).toBe(400);
    }
    expect(settleWithPolicy).not.toHaveBeenCalled();
  });

  it("refuses an unknown mode", async () => {
    expect((await post({ ...tranche, mode: "whatever", releaseDeadline: "1900000000" })).status).toBe(400);
  });

  it("passes a well-formed tranche through with the parsed deadline", async () => {
    settleTranche.mockResolvedValue({ txHash: H32 });
    const res = await post({ ...tranche, releaseDeadline: "1900000000" });
    expect(res.status).toBe(200);
    expect(settleTranche).toHaveBeenCalledWith(expect.objectContaining({ releaseDeadline: 1900000000n }));
  });
});
