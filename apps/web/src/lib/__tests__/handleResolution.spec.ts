import { describe, expect, it, vi, beforeEach } from "vitest";

// T-E2 (continued): resolving a FurlPay handle ("alice", displayed alice.furlpay) returns the owner's VERIFIED
// linked wallet — or says the name cannot receive. It used to return the
// keyless safeAddress, so paying a FurlPay user by handle lost the funds.

const H = vi.hoisted(() => ({ linked: null as null | Record<string, unknown>, lookupThrows: false }));

vi.mock("@/lib/walletHandles", async (orig) => ({
  ...(await orig<typeof import("@/lib/walletHandles")>()),
  getHandle: vi.fn(async () => ({ ownerId: "owner_1" })),
}));
vi.mock("@/lib/store", () => ({
  getAccountDurable: vi.fn(async () => ({ user: { id: "owner_1", safeAddress: "0x" + "5a".repeat(20) } })),
}));
vi.mock("@/lib/linkedWalletStore", () => ({
  loadLinkedWallet: vi.fn(async () => {
    if (H.lookupThrows) throw new Error("db down");
    return H.linked;
  }),
}));

import { resolveName } from "../nameResolution";

beforeEach(() => {
  H.linked = null;
  H.lookupThrows = false;
});

describe("FurlPay handle resolution", () => {
  it("returns the verified linked wallet", async () => {
    H.linked = { address: "0x" + "ab".repeat(20), status: "active", verificationMethod: "eip191" };
    const r = await resolveName("alice");
    expect(r).toMatchObject({ status: "resolved", result: { address: "0x" + "ab".repeat(20), family: "evm" } });
  });

  it("owner without a wallet → no_receive_address, never the placeholder", async () => {
    const r = await resolveName("alice");
    expect(r.status).toBe("no_receive_address");
    expect(JSON.stringify(r)).not.toContain("5a5a5a5a");
  });

  it("a failed wallet lookup is 'unavailable', not a guess", async () => {
    H.lookupThrows = true;
    expect((await resolveName("alice")).status).toBe("unavailable");
  });
});
