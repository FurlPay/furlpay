import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AmlScreenResult } from "@furlpay/compliance";

// screenAddressRisk = OFAC first (local, synchronous), then Circle when it
// covers the chain; the stricter verdict wins, and an OFAC block never waits on
// Circle.

const H = vi.hoisted(() => ({
  ofac: null as unknown as AmlScreenResult,
  circle: null as AmlScreenResult | null,
  circleCalls: 0,
}));

vi.mock("@furlpay/compliance", () => ({ screenWallet: () => H.ofac }));
vi.mock("@/lib/services/circleCompliance", () => ({
  screenAddressCircle: async () => {
    H.circleCalls++;
    return H.circle;
  },
}));

import { screenAddressRisk } from "@/lib/compliance/addressScreening";

const r = (provider: AmlScreenResult["provider"], action: AmlScreenResult["action"], categories: string[] = []): AmlScreenResult => ({
  address: "0xabc",
  provider,
  risk: action === "block" ? "severe" : action === "review" ? "medium" : "low",
  score: action === "block" ? 100 : 0,
  sanctioned: action === "block",
  categories,
  action,
});

beforeEach(() => {
  H.ofac = r("ofac-sdn", "allow");
  H.circle = null;
  H.circleCalls = 0;
});

describe("screenAddressRisk", () => {
  it("OFAC block short-circuits — Circle is not consulted", async () => {
    H.ofac = r("ofac-sdn", "block", ["sanctions"]);
    expect((await screenAddressRisk("0xabc", "ethereum")).action).toBe("block");
    expect(H.circleCalls).toBe(0);
  });
  it("Circle unconfigured/unsupported → OFAC verdict", async () => {
    expect(await screenAddressRisk("0xabc", "base")).toEqual(H.ofac);
  });
  it.each(["review", "block"] as const)("Circle %s overrides an OFAC allow", async (action) => {
    H.circle = r("circle", action, ["x"]);
    const out = await screenAddressRisk("0xabc", "ethereum");
    expect(out.action).toBe(action);
    expect(out.provider).toBe("circle");
  });
  it("both allow → allow, categories merged", async () => {
    H.ofac = r("ofac-sdn", "allow", ["a"]);
    H.circle = r("circle", "allow", ["b"]);
    expect(await screenAddressRisk("0xabc", "ethereum")).toMatchObject({ action: "allow", categories: ["a", "b"] });
  });
});
