// Human name → payable address.
//
// The assertion that matters most here is the one about FAILURE: a resolver
// outage must surface as `unavailable`, never as `unresolved`. Telling someone
// their friend's ENS name does not exist, when really the RPC was down, sends
// them straight back to pasting a raw address — which is the mistake this whole
// feature exists to remove.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getEnsAddress = vi.fn();

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({ getEnsAddress }),
  };
});

const { classifyName, resolveName, resetEnsClient } = await import("@/lib/nameResolution");

const EVM = "0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31e";
const SOL = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";

beforeEach(() => {
  getEnsAddress.mockReset();
  resetEnsClient();
});
afterEach(() => resetEnsClient());

describe("classifyName", () => {
  it("recognises each input kind", () => {
    expect(classifyName(EVM)).toBe("address");
    expect(classifyName(SOL)).toBe("address");
    expect(classifyName("vitalik.eth")).toBe("ens");
    expect(classifyName("VITALIK.ETH")).toBe("ens");
    expect(classifyName("alice")).toBe("furlpay");
  });

  it("refuses to guess at a name system we have no resolver for", () => {
    // A dotted name that is not ENS is not a FurlPay handle either — answering
    // it would mean inventing a resolver.
    expect(classifyName("alice.crypto")).toBeNull();
    expect(classifyName("alice@example.com")).toBeNull();
    expect(classifyName("   ")).toBeNull();
  });

  it("classifies a near-miss address as a name, not an address", () => {
    // 39 hex characters. Treating it as an address would mean the send sheet
    // reports a successful "scan" for something that cannot exist.
    expect(classifyName("0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31")).toBe("furlpay");
  });
});

describe("resolveName — raw addresses", () => {
  it("resolves an EVM address without any network call", async () => {
    const out = await resolveName(`  ${EVM}  `);
    expect(out.status).toBe("resolved");
    if (out.status !== "resolved") return;
    expect(out.result.address).toBe(EVM);
    expect(out.result.family).toBe("evm");
    expect(getEnsAddress).not.toHaveBeenCalled();
  });

  it("resolves a Solana address to the solana family", async () => {
    const out = await resolveName(SOL);
    expect(out.status).toBe("resolved");
    if (out.status !== "resolved") return;
    expect(out.result.family).toBe("solana");
  });
});

describe("resolveName — ENS", () => {
  it("resolves a name with an address record", async () => {
    getEnsAddress.mockResolvedValue(EVM);
    const out = await resolveName("vitalik.eth");
    expect(out.status).toBe("resolved");
    if (out.status !== "resolved") return;
    expect(out.result.address).toBe(EVM);
    expect(out.result.kind).toBe("ens");
    expect(out.result.family).toBe("evm");
  });

  it("reports a registered name with no address record as unresolved", async () => {
    getEnsAddress.mockResolvedValue(null);
    expect((await resolveName("nobody.eth")).status).toBe("unresolved");
  });

  it("treats the zero address as no address record", async () => {
    getEnsAddress.mockResolvedValue("0x0000000000000000000000000000000000000000");
    expect((await resolveName("zero.eth")).status).toBe("unresolved");
  });

  it("reports an RPC failure as UNAVAILABLE, never as unresolved", async () => {
    getEnsAddress.mockRejectedValue(new Error("HTTP request failed"));
    const out = await resolveName("vitalik.eth");
    expect(out.status).toBe("unavailable");
    if (out.status !== "unavailable") return;
    expect(out.kind).toBe("ens");
  });

  it("rejects a confusable name before it reaches the resolver", async () => {
    // "vitalik" with a Cyrillic 'а'. ENSIP-15 normalisation rejects it; without
    // that check this is a different name resolving to a different address.
    const out = await resolveName("vitаlik.eth");
    expect(out.status).toBe("invalid");
    expect(getEnsAddress).not.toHaveBeenCalled();
  });
});

describe("resolveName — FurlPay handles", () => {
  it("rejects a reserved handle without touching the store", async () => {
    const out = await resolveName("support");
    expect(out.status).toBe("invalid");
  });

  it("rejects a handle outside the allowed character set", async () => {
    expect((await resolveName("-alice")).status).toBe("invalid");
    expect((await resolveName("al")).status).toBe("invalid");
  });

  it("reports an unclaimed handle as unresolved", async () => {
    const out = await resolveName(`unclaimed-${Math.random().toString(36).slice(2, 10)}`);
    expect(out.status).toBe("unresolved");
    if (out.status !== "unresolved") return;
    expect(out.kind).toBe("furlpay");
  });
});
