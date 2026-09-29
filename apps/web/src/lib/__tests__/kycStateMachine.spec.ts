import { describe, expect, it } from "vitest";
import {
  canTransitionKyc,
  assertKycTransition,
  KycTransitionError,
  type KycStatus,
} from "../kycStateMachine";

const ALL: KycStatus[] = ["unverified", "pending", "verified"];

describe("canTransitionKyc", () => {
  it("permits the legitimate transitions", () => {
    expect(canTransitionKyc("unverified", "pending")).toBe(true);
    expect(canTransitionKyc("pending", "verified")).toBe(true);
    expect(canTransitionKyc("pending", "unverified")).toBe(true);
    expect(canTransitionKyc("verified", "unverified")).toBe(true);
    expect(canTransitionKyc("verified", "pending")).toBe(true);
  });

  it("forbids skipping the provider decision (unverified → verified)", () => {
    expect(canTransitionKyc("unverified", "verified")).toBe(false);
  });

  it("treats a no-op transition as allowed (idempotent)", () => {
    for (const s of ALL) expect(canTransitionKyc(s, s)).toBe(true);
  });

  it("rejects an unknown status defensively", () => {
    expect(canTransitionKyc("bogus" as KycStatus, "verified")).toBe(false);
  });
});

describe("assertKycTransition", () => {
  it("throws a typed error naming both states on an illegal move", () => {
    try {
      assertKycTransition("unverified", "verified");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(KycTransitionError);
      expect((e as KycTransitionError).from).toBe("unverified");
      expect((e as KycTransitionError).to).toBe("verified");
    }
  });

  it("does not throw on a legal move", () => {
    expect(() => assertKycTransition("pending", "verified")).not.toThrow();
  });
});

// Exhaustive matrix: every from×to pair has a defined, deterministic verdict.
describe("transition matrix is total", () => {
  it("returns a boolean for every pair and never throws", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        expect(typeof canTransitionKyc(from, to)).toBe("boolean");
      }
    }
  });
});
