import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  __resetMembershipForTests,
  accrueCashback,
  cashbackHistory,
  changePlan,
  claimAndCreditCashback,
} from "../services/membership";
import { findOrCreateUserByIdentity, getAccount } from "../store";
import * as ledgerMod from "../ledger";

// Cashback claim-and-pay is one operation (dev path). The durable path is the
// SQL function proven on real PostgreSQL by scripts/db/verify-financial-effects.mjs
// (100 concurrent / barrier-synchronised claims → one payout; A never receives B's).

let uid = "";
const usdc = () => getAccount(uid)!.tokenBalances.find((b) => b.token === "USDC" && b.chain === "arbitrum")?.amount ?? 0;

beforeEach(() => {
  __resetMembershipForTests();
  ledgerMod.__resetAppliedEffectsForTests();
  uid = findOrCreateUserByIdentity({ email: `cb-${randomUUID()}@example.com` }).account.user.id;
  changePlan(uid, "Pro");
});

describe("claimAndCreditCashback", () => {
  it("pays the accrued total once; a retry pays nothing", async () => {
    accrueCashback(uid, { transactionId: "t1", merchant: "M", mcc: "5411", spendUsd: 100 });
    const first = await claimAndCreditCashback(uid);
    expect(first.applied).toBe(true);
    const paid = usdc();
    expect(paid).toBeGreaterThan(0);
    await expect(claimAndCreditCashback(uid)).rejects.toThrow("Nothing to claim");
    expect(usdc()).toBe(paid);
  });

  it("a failed credit does NOT consume the accruals (no claimed-but-unpaid state)", async () => {
    accrueCashback(uid, { transactionId: "t2", merchant: "M", mcc: "5411", spendUsd: 100 });
    const spy = vi.spyOn(ledgerMod, "applyFinancialEffect").mockRejectedValueOnce(new Error("db down"));
    await expect(claimAndCreditCashback(uid)).rejects.toThrow("db down");
    spy.mockRestore();
    expect(cashbackHistory(uid).every((a) => a.claimedAt === null)).toBe(true);
    const retry = await claimAndCreditCashback(uid);
    expect(retry.applied).toBe(true);
  });

  it("only the caller's accruals are paid", async () => {
    const other = findOrCreateUserByIdentity({ email: `cb-other-${randomUUID()}@example.com` }).account.user.id;
    changePlan(other, "Pro");
    accrueCashback(other, { transactionId: "o1", merchant: "M", mcc: "5411", spendUsd: 1000 });
    accrueCashback(uid, { transactionId: "u1", merchant: "M", mcc: "5411", spendUsd: 100 });
    await claimAndCreditCashback(uid);
    expect(cashbackHistory(other).every((a) => a.claimedAt === null)).toBe(true);
  });
});
