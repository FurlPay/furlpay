import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { applyStripeDispute, applyStripeRefund } from "../stripeReversals";
import { ACCOUNTS, applyFinancialEffect, ledger, movementPostings, __resetAppliedEffectsForTests } from "@/lib/ledger";

// T-P3 (audit P2-7): refunds and chargebacks are balanced, keyed, exactly-once
// ledger transactions against the real ledger module.

const ack = { provider: "stripe", eventId: "evt_test" };
let userId = "";
const resolve = async () => userId;
const liability = () => ledger.balanceOf(`acct_2000_${userId}`);
const chargebacks = () => ledger.balanceOf(ACCOUNTS.CHARGEBACK_LIABILITY.id);

beforeEach(async () => {
  __resetAppliedEffectsForTests();
  userId = randomUUID();
  // The original funding: $50 in via stripe:pi.
  await applyFinancialEffect({ effectKey: `stripe:pi:pi_${userId}`, memo: "fund", ...movementPostings("in", 50, userId) });
});

describe("refunds", () => {
  it("a succeeded refund reduces what we owe, once", async () => {
    const refund = { id: `re_${userId}`, amount: 2000, currency: "usd", status: "succeeded", payment_intent: "pi_1" };
    const a = await applyStripeRefund(refund, resolve, ack);
    const b = await applyStripeRefund(refund, resolve, ack); // refund.updated redelivery / charge.refunded
    expect(a.applied).toEqual([`stripe:refund:re_${userId}`]);
    expect(b.skipped).toEqual([`stripe:refund:re_${userId}`]);
    expect(liability()).toBe(3000);
  });

  it("pending/failed refunds and non-USD are not posted", async () => {
    expect((await applyStripeRefund({ id: "re_p", amount: 100, currency: "usd", status: "pending", payment_intent: "pi" }, resolve, ack)).reason).toBe("refund_pending");
    expect((await applyStripeRefund({ id: "re_e", amount: 100, currency: "eur", status: "succeeded", payment_intent: "pi" }, resolve, ack)).reason).toBe("unsupported_currency");
    expect(liability()).toBe(5000);
  });

  it("an unresolvable customer is not guessed", async () => {
    const r = await applyStripeRefund({ id: "re_x", amount: 100, currency: "usd", status: "succeeded", payment_intent: "pi" }, async () => null, ack);
    expect(r.reason).toBe("user_unresolved");
  });
});

describe("disputes", () => {
  const dispute = (status: string) => ({ id: `dp_${userId}`, amount: 5000, currency: "usd", status, payment_intent: "pi_1" });

  it("opened moves the amount into chargeback liability", async () => {
    const before = chargebacks();
    await applyStripeDispute(dispute("needs_response"), "opened", resolve, ack);
    expect(liability()).toBe(0);
    expect(chargebacks() - before).toBe(5000);
  });

  it("won releases the hold back to the customer", async () => {
    const before = chargebacks();
    await applyStripeDispute(dispute("needs_response"), "opened", resolve, ack);
    const r = await applyStripeDispute(dispute("won"), "closed", resolve, ack);
    expect(r.applied).toEqual([`stripe:dispute:dp_${userId}:won`]);
    expect(liability()).toBe(5000);
    expect(chargebacks() - before).toBe(0);
  });

  it("lost settles the hold out of escrow; a closed event with no prior 'opened' still posts the hold first", async () => {
    const before = chargebacks();
    const r = await applyStripeDispute(dispute("lost"), "closed", resolve, ack);
    expect(r.applied).toEqual([`stripe:dispute:dp_${userId}:opened`, `stripe:dispute:dp_${userId}:lost`]);
    expect(liability()).toBe(0);
    expect(chargebacks() - before).toBe(0);
    // Redelivered: nothing moves again.
    const again = await applyStripeDispute(dispute("lost"), "closed", resolve, ack);
    expect(again.applied).toEqual([]);
  });

  it("every reversal transaction balances", async () => {
    await applyStripeDispute(dispute("lost"), "closed", resolve, ack);
    for (const key of ["opened", "lost"]) {
      const tx = ledger.listTransactions().find((t) => t.memo === `Stripe dispute dp_${userId} ${key}`)!;
      const debits = tx.postings.filter((p) => p.side === "debit").reduce((s, p) => s + p.amount, 0);
      const credits = tx.postings.filter((p) => p.side === "credit").reduce((s, p) => s + p.amount, 0);
      expect(debits).toBe(credits);
    }
  });
});
