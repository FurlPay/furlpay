import { describe, it, expect } from "vitest";
import { frozenPrefixes, isFrozenRoute } from "@/lib/featureGate";

// The consumer-route freeze is a product decision with live users behind it, so
// the default must be "nothing frozen" and a bad value must not widen it.

describe("featureGate", () => {
  it("freezes nothing when the variable is unset or empty", () => {
    expect(frozenPrefixes(undefined)).toEqual([]);
    expect(frozenPrefixes("")).toEqual([]);
    expect(isFrozenRoute("/api/travel/hotels", frozenPrefixes(undefined))).toBe(false);
  });

  it("freezes only the configured prefixes", () => {
    const p = frozenPrefixes("/api/travel, /api/investing");
    expect(isFrozenRoute("/api/travel/hotels", p)).toBe(true);
    expect(isFrozenRoute("/api/investing", p)).toBe(true);
    expect(isFrozenRoute("/api/p2p/orders", p)).toBe(false);
  });

  it("ignores prefixes outside the allow-list, so auth and the control plane cannot be frozen", () => {
    const p = frozenPrefixes("/api,/api/auth,/api/v1,/api/control-plane,/api/travel");
    expect(p).toEqual(["/api/travel"]);
    expect(isFrozenRoute("/api/auth/session", p)).toBe(false);
    expect(isFrozenRoute("/api/v1/payments/authorize", p)).toBe(false);
  });

  it("matches whole path segments only", () => {
    const p = frozenPrefixes("/api/nft");
    expect(isFrozenRoute("/api/nft", p)).toBe(true);
    expect(isFrozenRoute("/api/nft/mint", p)).toBe(true);
    expect(isFrozenRoute("/api/nfts", p)).toBe(false);
  });
});
