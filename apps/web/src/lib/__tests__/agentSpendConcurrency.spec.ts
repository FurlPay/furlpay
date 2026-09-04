import { describe, it, expect, beforeEach } from "vitest";
import { authorizeAgentSpend, registerOwnedAgentKey } from "../agentPolicy";

// ---------------------------------------------------------------------------
// The agent spend limiter under concurrency.
//
// A spend limit that is checked and then written in two steps is not a limit.
// Ten simultaneous $20 requests against a $50/day budget each read "spent so
// far: $0", each conclude they fit, and $200 leaves the account. That race —
// check-then-act, or TOCTOU — is the defect this file exists to catch, and it
// cannot be caught by a sequential test: every one of these requests is
// individually valid.
//
// authorizeAgentSpend defends against it by RESERVING first: the amount is
// added to an atomic counter before the comparison, and refunded if it
// overshot. Two concurrent spends can therefore both be denied, but the
// budget can never be exceeded. Denying a request that would have fit is a
// retry; allowing one that does not fit is money gone.
// ---------------------------------------------------------------------------

const USER = "user_concurrency";

// Any valid SPKI PEM works: these tests exercise the POLICY gate, which runs
// after signature verification and never re-parses the key.
const PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7VgMPmEwYcAQPHtGY7ZDPYCPX3FjJ0i8sJ0zdiV6XNw=
-----END PUBLIC KEY-----`;

beforeEach(() => {
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
});

async function agentWithBudget(dailyBudgetUsd: number, perTxLimitUsd: number) {
  const record = await registerOwnedAgentKey({
    userId: USER,
    name: "Concurrency agent",
    publicKeyPem: PEM,
    policy: {
      perTxLimitUsd,
      dailyBudgetUsd,
      allowedCategories: ["x402", "commerce", "travel"],
    },
  });
  return record.keyId;
}

describe("concurrent spends cannot exceed the daily budget", () => {
  it("allows at most 2 of 10 simultaneous $20 requests against a $50 budget", async () => {
    const keyId = await agentWithBudget(50, 25);

    // The scenario exactly as specified: fired together, not in sequence.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 20, category: "x402" })
      )
    );

    const allowed = results.filter((r) => r.allowed);
    const totalSpent = allowed.length * 20;

    expect(totalSpent).toBeLessThanOrEqual(50);
    // $50 / $20 = 2 whole transactions. The third would reach $60.
    expect(allowed).toHaveLength(2);
    expect(results.filter((r) => !r.allowed)).toHaveLength(8);
  });

  it("refunds the over-reservation so the budget is not stranded", async () => {
    const keyId = await agentWithBudget(50, 25);

    // Eight of these must be denied, each having briefly reserved $20. If the
    // refund did not happen, the counter would sit at $200 and the remaining
    // $10 of real budget would be unusable for the rest of the day.
    await Promise.all(
      Array.from({ length: 10 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 20, category: "x402" })
      )
    );

    const small = await authorizeAgentSpend({ keyId, amountUsd: 10, category: "x402" });
    expect(small.allowed).toBe(true);
    if (small.allowed) expect(small.spentTodayUsd).toBe(50);
  });

  it("spends the budget to the cent without overshooting", async () => {
    const keyId = await agentWithBudget(1, 1);

    // 100 concurrent 1-cent spends against a $1.00 budget: every one fits, and
    // the total must land exactly on the limit rather than one cent past it.
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 0.01, category: "commerce" })
      )
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(100);

    const overflow = await authorizeAgentSpend({ keyId, amountUsd: 0.01, category: "commerce" });
    expect(overflow.allowed).toBe(false);
    if (!overflow.allowed) expect(overflow.reason).toBe("daily_budget_exceeded");
  });

  it("holds the per-transaction ceiling under concurrency too", async () => {
    const keyId = await agentWithBudget(1_000, 25);

    // A generous daily budget must not let a single oversized charge through:
    // the two limits are independent, and the per-tx cap is the one that stops
    // a decimal-place slip becoming a $2,600 payment.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 26, category: "x402" })
      )
    );
    expect(results.every((r) => !r.allowed)).toBe(true);
    for (const r of results) {
      if (!r.allowed) expect(r.reason).toBe("per_tx_limit_exceeded");
    }
  });

  it("denies every concurrent spend once the key is revoked", async () => {
    const keyId = await agentWithBudget(1_000, 100);
    const { revokeAgentKey } = await import("../agentPolicy");
    await revokeAgentKey(USER, keyId);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 5, category: "x402" })
      )
    );
    // Revocation is a security boundary, so it is checked before the budget
    // and holds for every racing request rather than most of them.
    expect(results.every((r) => !r.allowed)).toBe(true);
    for (const r of results) {
      if (!r.allowed) expect(r.reason).toBe("key_revoked");
    }
  });

  it("denies a category the policy never granted, however many ask at once", async () => {
    const keyId = await agentWithBudget(1_000, 100);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 5, category: "transfer" })
      )
    );
    expect(results.every((r) => !r.allowed)).toBe(true);
  });

  it("keeps one agent's spending out of another's budget", async () => {
    const a = await agentWithBudget(50, 25);
    const bRecord = await registerOwnedAgentKey({
      userId: "user_other",
      name: "Other agent",
      // A DIFFERENT key: the counter is keyed by keyId, so two agents sharing
      // one PEM would share one budget.
      publicKeyPem: PEM.replace("7VgMPmEwYcAQPHtGY7ZDPYCPX3FjJ0i8sJ0zdiV6XNw", "8WhNQnFxZdBRQIuHZ8AEQZDQY4GkK1j9tK1aejW7YOx"),
      policy: { perTxLimitUsd: 25, dailyBudgetUsd: 50, allowedCategories: ["x402"] },
    });

    await Promise.all(
      Array.from({ length: 10 }, () => authorizeAgentSpend({ keyId: a, amountUsd: 20, category: "x402" }))
    );

    // Agent A exhausted its own budget. Agent B must be untouched.
    const b = await authorizeAgentSpend({ keyId: bRecord.keyId, amountUsd: 20, category: "x402" });
    expect(b.allowed).toBe(true);
  });
});
