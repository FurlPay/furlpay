import { describe, expect, it } from "vitest";
import { canCreditDeposit, getDepositPolicy, isDepositFinal } from "@/lib/chains/depositConfirmation";
import { ASSETS, NETWORKS } from "../model";
import { settlementSchema, treasurySchema } from "../onboarding";
import { settlement } from "./fixtures";

// Chain capability matrix for the Settlement OS.
//
// A network is offered for settlement only if FurlPay can CREDIT deposits on it
// safely: a reorg-aware confirmation policy (lib/chains/depositConfirmation.ts)
// in front of the deposit-detect webhook. Settlement execution itself (moving
// funds per split rules) is not implemented on any chain in this release —
// rules are configuration only.
//
//   network    deposit policy   offered
//   arbitrum   yes              yes
//   base       yes              yes
//   ethereum   yes              yes
//   solana     yes              yes
//   polygon    yes              yes
//   avalanche  NO               no  (rejected by the server)
//
// Assets: stablecoins and fiat only. SOL and ETH (native tokens) are not
// settlement assets and are rejected.

describe("settlement chain capability matrix", () => {
  it("every offered network has a deposit confirmation policy", () => {
    for (const n of NETWORKS) expect(getDepositPolicy(n), n).toBeDefined();
  });

  it("the offered networks are exactly the five with deposit crediting", () => {
    expect([...NETWORKS].sort()).toEqual(["arbitrum", "base", "ethereum", "polygon", "solana"]);
  });

  it("avalanche has no deposit policy and is rejected by the server schemas", () => {
    expect(getDepositPolicy("avalanche")).toBeUndefined();
    expect(treasurySchema.safeParse({ networks: ["avalanche"], assets: ["USDC"], destination: "treasury" }).success).toBe(false);
    expect(treasurySchema.safeParse({ networks: ["base", "avalanche"], assets: ["USDC"], destination: "treasury" }).success).toBe(false);
    const s = settlement([100]);
    expect(settlementSchema.safeParse({ ...s, routing: [{ network: "avalanche", enabled: true, primary: true }] }).success).toBe(false);
  });

  it("SOL and ETH are not settlement assets and are rejected", () => {
    expect(ASSETS).not.toContain("SOL");
    expect(ASSETS).not.toContain("ETH");
    for (const a of ["SOL", "ETH", "PYUSD"]) expect(treasurySchema.safeParse({ networks: ["base"], assets: [a], destination: "treasury" }).success, a).toBe(false);
    const s = settlement([100]);
    expect(settlementSchema.safeParse({ ...s, rules: [{ ...s.rules[0], assets: ["ETH"] }] }).success).toBe(false);
  });
});

describe("deposit policy lookup is prototype-safe", () => {
  it("prototype member names never yield a policy or a safe credit", () => {
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "prototype"]) {
      expect(getDepositPolicy(name), name).toBeUndefined();
      expect(canCreditDeposit(name, 0).safe, name).toBe(false);
      expect(canCreditDeposit(name, 1_000_000).safe, name).toBe(false);
      expect(isDepositFinal(name, 1_000_000), name).toBe(false);
    }
  });
  it("a real chain still needs its confirmation depth", () => {
    const p = getDepositPolicy("ethereum")!;
    expect(canCreditDeposit("ethereum", p.minConfirmations - 1).safe).toBe(false);
    expect(canCreditDeposit("ethereum", p.minConfirmations).safe).toBe(true);
  });
});
