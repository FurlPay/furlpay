import { describe, it, expect } from "vitest";
import {
  canMove,
  coverage,
  holdsFor,
  isOwnAddress,
  TREASURY_WALLETS,
  walletsForEnvironment,
  type WalletPurpose,
} from "../register";

// ---------------------------------------------------------------------------
// The treasury register.
//
// The property under test: FurlPay has no unknown addresses, and customer money
// cannot reach a corporate wallet through an automated path.
// ---------------------------------------------------------------------------

const ALL_PURPOSES: WalletPurpose[] = [
  "customer_custody",
  "deposit_collection",
  "withdrawal_hot",
  "gas_fee_payer",
  "corporate_treasury",
  "provider_settlement",
  "cold_reserve",
];

describe("the register is honestly empty", () => {
  it("declares no treasury wallet in any environment", () => {
    // No wallet has been provisioned under a documented control policy.
    // Seeding plausible addresses would make reconciliation sum balances at
    // addresses nobody controls and report them as customer coverage.
    expect(TREASURY_WALLETS).toHaveLength(0);
    expect(walletsForEnvironment("production")).toHaveLength(0);
  });

  it("recognises no address as its own", () => {
    expect(isOwnAddress("arbitrum", "0x" + "11".repeat(20))).toBe(false);
  });
});

describe("segregation is derived, not hand-set", () => {
  it("classifies every purpose as customer or corporate", () => {
    for (const purpose of ALL_PURPOSES) {
      expect(["customer", "corporate"], purpose).toContain(holdsFor(purpose));
    }
  });

  it("puts the gas fee-payer on the CORPORATE side", () => {
    // Gas is our money spent on a customer's behalf. Counting it toward
    // customer coverage overstates solvency by exactly the gas float.
    expect(holdsFor("gas_fee_payer")).toBe("corporate");
  });

  it("puts deposit collection and withdrawal hot wallets on the CUSTOMER side", () => {
    expect(holdsFor("deposit_collection")).toBe("customer");
    expect(holdsFor("withdrawal_hot")).toBe("customer");
    expect(holdsFor("customer_custody")).toBe("customer");
  });
});

describe("movement guards refuse before they permit", () => {
  it("refuses a wallet that is not in the register", () => {
    // An address that is not declared is not ours, whatever a config says.
    const decision = canMove({
      fromWalletId: "not-declared",
      toWalletId: "also-not-declared",
      assetId: "USDC.arbitrum",
      amountMinor: 1_000n,
      automated: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("unknown_wallet");
  });

  it("refuses every movement while the register is empty", () => {
    // Fail-closed by construction: with nothing declared, nothing can move.
    // This is the state the platform is genuinely in, and the guard reflects it
    // rather than defaulting to permissive until wallets appear.
    for (const automated of [true, false]) {
      expect(
        canMove({
          fromWalletId: "a",
          toWalletId: "b",
          assetId: "USDC.arbitrum",
          amountMinor: 1n,
          automated,
        }).allowed
      ).toBe(false);
    }
  });
});

describe("coverage counts only declared customer backing", () => {
  it("reports a shortfall when nothing backs the liability", () => {
    const report = coverage({
      customerLiabilityMinor: 1_000_000n,
      backingBalances: [],
    });
    expect(report.covered).toBe(false);
    expect(report.backingMinor).toBe(0n);
    expect(report.surplusMinor).toBe(-1_000_000n);
  });

  it("does NOT count a balance at an undeclared wallet as coverage", () => {
    // The failure this prevents: a large corporate or unrecognised balance
    // making an uncovered book look solvent. It is reported as a finding
    // instead of silently dropped OR silently counted.
    const report = coverage({
      customerLiabilityMinor: 500_000n,
      backingBalances: [{ walletId: "some-corporate-wallet", minor: 900_000n }],
    });
    expect(report.covered).toBe(false);
    expect(report.backingMinor).toBe(0n);
    expect(report.ignoredWallets).toEqual(["some-corporate-wallet"]);
  });

  it("treats exact coverage as covered", () => {
    const report = coverage({ customerLiabilityMinor: 0n, backingBalances: [] });
    expect(report.covered).toBe(true);
    expect(report.surplusMinor).toBe(0n);
  });
});
