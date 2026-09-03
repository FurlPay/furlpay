import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetMembershipForTests,
  getSubscription,
  changePlan,
  cancelPendingTransition,
  scheduleSystemDowngrade,
  applyDueTransitions,
  setAutoRenew,
  subscriptionHistory,
  accrueCashback,
  cashbackSummary,
  cashbackHistory,
  claimCashback,
  setCashbackProgramStatus,
  earnedInPeriod,
  multiplierFor,
  planFor,
} from "@/lib/services/membership";

// The money question in a subscription is WHEN a change takes effect. Upgrades
// now, downgrades at the boundary the customer already paid for. These specs
// pin that asymmetry, and the cashback rules that ride on it.

const U = "user-member";

beforeEach(() => {
  __resetMembershipForTests();
});

describe("plan changes", () => {
  it("starts every account on the free plan with nothing to bill", () => {
    const sub = getSubscription(U);
    expect(sub.planId).toBe("Standard");
    expect(sub.nextBillingAt).toBeNull();
    expect(sub.autoRenew).toBe(false);
  });

  it("applies an upgrade immediately and charges for it", () => {
    const r = changePlan(U, "Pro");
    expect(r.effect).toBe("immediate");
    expect(r.chargeUsd).toBe(planFor("Pro").monthlyUsd);
    expect(getSubscription(U).planId).toBe("Pro");
    expect(getSubscription(U).nextBillingAt).not.toBeNull();
  });

  it("SCHEDULES a downgrade instead of applying it, and charges nothing", () => {
    changePlan(U, "Ultra");
    const boundary = getSubscription(U).nextBillingAt;

    const r = changePlan(U, "Pro");
    expect(r.effect).toBe("scheduled");
    expect(r.chargeUsd).toBe(0);

    const sub = getSubscription(U);
    // Still Ultra — they paid for this period and keep it to the boundary.
    expect(sub.planId).toBe("Ultra");
    expect(sub.pendingPlanId).toBe("Pro");
    expect(sub.pendingTransitionAt).toBe(boundary);
    expect(sub.status).toBe("downgrade_pending");
  });

  it("refuses a no-op change rather than re-charging", () => {
    changePlan(U, "Pro");
    expect(() => changePlan(U, "Pro")).toThrow(/Already on this plan/);
  });

  it("treats monthly to annual on the same tier as an upgrade", () => {
    changePlan(U, "Pro");
    const r = changePlan(U, "Pro", "annual");
    expect(r.effect).toBe("immediate");
    expect(r.chargeUsd).toBe(planFor("Pro").annualUsd);
    expect(getSubscription(U).period).toBe("annual");
  });

  it("lets an upgrade supersede a scheduled downgrade", () => {
    changePlan(U, "Pro");
    changePlan(U, "Standard");
    expect(getSubscription(U).pendingPlanId).toBe("Standard");

    changePlan(U, "Ultra");
    const sub = getSubscription(U);
    expect(sub.planId).toBe("Ultra");
    // You are not simultaneously going up and down.
    expect(sub.pendingPlanId).toBeNull();
    expect(sub.status).toBe("active");
  });

  it("withdraws a scheduled downgrade without starting a new period", () => {
    changePlan(U, "Pro");
    const billing = getSubscription(U).nextBillingAt;
    changePlan(U, "Standard");

    const sub = cancelPendingTransition(U);
    expect(sub.planId).toBe("Pro");
    expect(sub.pendingPlanId).toBeNull();
    expect(sub.status).toBe("active");
    expect(sub.nextBillingAt).toBe(billing);
  });

  it("refuses to cancel a transition that does not exist", () => {
    expect(() => cancelPendingTransition(U)).toThrow(/No pending transition/);
  });
});

describe("involuntary downgrade", () => {
  it("schedules rather than applying, so a failed charge does not strip benefits early", () => {
    changePlan(U, "Ultra");
    const sub = scheduleSystemDowngrade(U);
    expect(sub.planId).toBe("Ultra");
    expect(sub.pendingPlanId).toBe("Standard");
    expect(sub.pendingReason).toBe("system_downgrade");
    expect(sub.status).toBe("system_downgrade_pending");
  });

  it("is distinguishable from a customer downgrade", () => {
    changePlan(U, "Ultra");
    changePlan(U, "Pro");
    expect(getSubscription(U).pendingReason).toBe("downgrade");
  });
});

describe("applying due transitions", () => {
  it("does nothing before the boundary", () => {
    changePlan(U, "Pro");
    changePlan(U, "Standard");
    expect(applyDueTransitions(new Date())).toHaveLength(0);
    expect(getSubscription(U).planId).toBe("Pro");
  });

  it("applies once the boundary has passed", () => {
    changePlan(U, "Pro");
    changePlan(U, "Standard");
    const later = new Date(Date.now() + 40 * 86400_000);

    expect(applyDueTransitions(later)).toHaveLength(1);
    const sub = getSubscription(U);
    expect(sub.planId).toBe("Standard");
    expect(sub.status).toBe("canceled");
    expect(sub.pendingPlanId).toBeNull();
  });

  it("is safe to run repeatedly", () => {
    changePlan(U, "Pro");
    changePlan(U, "Standard");
    const later = new Date(Date.now() + 40 * 86400_000);
    applyDueTransitions(later);
    expect(applyDueTransitions(later)).toHaveLength(0);
  });
});

describe("auto-renew", () => {
  it("turning it off schedules the drop so the date is visible", () => {
    changePlan(U, "Pro");
    const sub = setAutoRenew(U, false);
    expect(sub.autoRenew).toBe(false);
    expect(sub.pendingPlanId).toBe("Standard");
    expect(sub.status).toBe("downgrade_pending");
  });

  it("turning it back on withdraws that", () => {
    changePlan(U, "Pro");
    setAutoRenew(U, false);
    const sub = setAutoRenew(U, true);
    expect(sub.pendingPlanId).toBeNull();
    expect(sub.status).toBe("active");
  });

  it("has nothing to do on the free plan", () => {
    expect(() => setAutoRenew(U, true)).toThrow(/does not renew/);
  });
});

describe("cashback accrual", () => {
  it("pays the plan rate times the category multiplier", () => {
    changePlan(U, "Pro"); // 1.5% base
    const { accrual } = accrueCashback(U, {
      transactionId: "tx1",
      merchant: "Qatar Airways",
      mcc: "4511", // 2x
      spendUsd: 1000,
    });
    expect(accrual?.rate).toBe(3);
    expect(accrual?.amountUsd).toBe(30);
  });

  it("never pays twice for the same transaction", () => {
    changePlan(U, "Pro");
    const first = accrueCashback(U, { transactionId: "tx1", merchant: "M", mcc: "5411", spendUsd: 100 });
    expect(first.accrual).not.toBeNull();

    const replay = accrueCashback(U, { transactionId: "tx1", merchant: "M", mcc: "5411", spendUsd: 100 });
    expect(replay.accrual).toBeNull();
    expect(replay.skipped).toBe("already_accrued");
    expect(cashbackHistory(U)).toHaveLength(1);
  });

  it("snapshots the rate, so a later downgrade cannot shrink what was earned", () => {
    changePlan(U, "Ultra"); // 3%
    accrueCashback(U, { transactionId: "tx1", merchant: "M", mcc: "9999", spendUsd: 1000 });
    expect(cashbackHistory(U)[0].amountUsd).toBe(30);

    // Drop to the free tier and let it take effect.
    changePlan(U, "Standard");
    applyDueTransitions(new Date(Date.now() + 40 * 86400_000));

    // The earned accrual is untouched.
    expect(cashbackHistory(U)[0].rate).toBe(3);
    expect(cashbackHistory(U)[0].amountUsd).toBe(30);
  });

  it("accrues partially up to the monthly cap, then stops", () => {
    changePlan(U, "Pro"); // cap 100
    accrueCashback(U, { transactionId: "a", merchant: "M", mcc: "9999", spendUsd: 6000 }); // 90
    expect(earnedInPeriod(U, cashbackSummary(U).period)).toBe(90);

    // Would be 30; only 10 of the cap is left, so 10 accrues.
    const partial = accrueCashback(U, { transactionId: "b", merchant: "M", mcc: "9999", spendUsd: 2000 });
    expect(partial.accrual?.amountUsd).toBe(10);

    const over = accrueCashback(U, { transactionId: "c", merchant: "M", mcc: "9999", spendUsd: 100 });
    expect(over.accrual).toBeNull();
    expect(over.skipped).toBe("cap_reached");
  });

  it("does not cap the uncapped plan", () => {
    changePlan(U, "Ultra");
    accrueCashback(U, { transactionId: "a", merchant: "M", mcc: "9999", spendUsd: 100_000 });
    expect(cashbackSummary(U).capRemainingUsd).toBeNull();
    expect(earnedInPeriod(U, cashbackSummary(U).period)).toBe(3000);
  });

  it("stops earning while the programme is deactivated for fraud", () => {
    changePlan(U, "Pro");
    setCashbackProgramStatus(U, "deactivated");
    const r = accrueCashback(U, { transactionId: "a", merchant: "M", mcc: "9999", spendUsd: 100 });
    expect(r.accrual).toBeNull();
    expect(r.skipped).toBe("program_disabled");
  });

  it("falls back to a 1x multiplier for an unknown category", () => {
    expect(multiplierFor("9999")).toBe(1);
    expect(multiplierFor("4511")).toBe(2);
  });
});

describe("cashback claiming", () => {
  it("sweeps every unclaimed accrual once", () => {
    changePlan(U, "Pro");
    accrueCashback(U, { transactionId: "a", merchant: "M", mcc: "9999", spendUsd: 1000 });
    accrueCashback(U, { transactionId: "b", merchant: "M", mcc: "9999", spendUsd: 1000 });

    const r = claimCashback(U);
    expect(r.claimedUsd).toBe(30);
    expect(r.accrualIds).toHaveLength(2);
    expect(cashbackSummary(U).unclaimedUsd).toBe(0);
    // Lifetime keeps counting claimed earnings.
    expect(cashbackSummary(U).lifetimeUsd).toBe(30);
  });

  it("refuses a second claim of the same accruals", () => {
    changePlan(U, "Pro");
    accrueCashback(U, { transactionId: "a", merchant: "M", mcc: "9999", spendUsd: 1000 });
    claimCashback(U);
    expect(() => claimCashback(U)).toThrow(/Nothing to claim/);
  });

  it("refuses to pay out while deactivated, but keeps the history readable", () => {
    changePlan(U, "Pro");
    accrueCashback(U, { transactionId: "a", merchant: "M", mcc: "9999", spendUsd: 1000 });
    setCashbackProgramStatus(U, "deactivated");

    expect(() => claimCashback(U)).toThrow(/not active/);
    // The block stops the payout; it does not erase what was earned.
    expect(cashbackHistory(U)).toHaveLength(1);
    expect(cashbackSummary(U).status).toBe("deactivated");
  });
});

describe("history", () => {
  it("records every change with what was charged", () => {
    changePlan(U, "Pro");
    changePlan(U, "Ultra");
    changePlan(U, "Pro");

    const events = subscriptionHistory(U);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type)).toContain("downgrade_scheduled");
    expect(events.map((e) => e.type)).toContain("activation");
    expect(events.find((e) => e.type === "downgrade_scheduled")?.amountUsd).toBe(0);
  });
});
