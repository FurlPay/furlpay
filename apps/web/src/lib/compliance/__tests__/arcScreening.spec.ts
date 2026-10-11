import { beforeEach, describe, expect, it, vi } from "vitest";

// ARC-P2-004: Arc addresses are screened against Arc's own USDC blocklist (the list
// that makes the transfer revert), not OFAC alone. Unanswerable => throw (fail closed).
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/payments/merchant/rpc", () => ({ rpc: h.rpc }));
vi.mock("@/lib/services/circleCompliance", () => ({ screenAddressCircle: vi.fn(async () => null) }));

import { screenAddressRisk } from "../addressScreening";

const ADDR = "0x" + "ab".repeat(20);
const answer = (v: 0 | 1) => "0x" + String(v).padStart(64, "0");
beforeEach(() => h.rpc.mockReset());

describe("Arc screening uses the enforcing USDC blocklist", () => {
  it("blocks an address Arc's USDC would refuse, asking with isBlacklisted on 0x3600", async () => {
    h.rpc.mockResolvedValue(answer(1));
    const r = await screenAddressRisk(ADDR, "arc");
    expect(r).toMatchObject({ action: "block", sanctioned: true });
    expect(r.categories).toContain("arc_usdc_blocklist");
    const [chain, method, [call]] = h.rpc.mock.calls[0];
    expect([chain, method]).toEqual(["arc", "eth_call"]);
    expect(call.to.toLowerCase()).toBe("0x3600000000000000000000000000000000000000");
    expect(call.data).toBe("0xfe575a87" + "0".repeat(24) + ADDR.slice(2));
  });
  it("allows a clear address and records which list was consulted", async () => {
    h.rpc.mockResolvedValue(answer(0));
    const r = await screenAddressRisk(ADDR, "arc");
    expect(r.action).toBe("allow");
    expect(r.categories).toContain("arc_usdc_blocklist_clear");
  });
  it("throws (fails closed) when the blocklist cannot be read", async () => {
    h.rpc.mockRejectedValue(new Error("Network reader unavailable"));
    await expect(screenAddressRisk(ADDR, "arc")).rejects.toThrow("Arc blocklist unavailable");
    h.rpc.mockResolvedValue("0x");
    await expect(screenAddressRisk(ADDR, "arc")).rejects.toThrow("Arc blocklist unavailable");
  });
  it("does not touch other chains", async () => {
    await screenAddressRisk(ADDR, "base");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
