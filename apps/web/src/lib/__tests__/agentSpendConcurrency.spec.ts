import { describe, it, expect, beforeEach } from "vitest";
import { authorizeAgentSpend, registerOwnedAgentKey } from "../agentPolicy";
import { burstConfigFrom, burstUsage } from "../agent/burstWindow";

/**
 * Read the burst window the policy layer would use for this key.
 *
 * Mirrors agentPolicy's own derivation rather than importing a private helper, so
 * a change to that derivation shows up here as a failing assertion instead of
 * silently agreeing with itself.
 */
async function burstUsageFor(keyId: string, dailyUsd: number, perTxUsd: number) {
  const dailyCents = Math.round(dailyUsd * 100);
  const perTxCents = Math.max(1, Math.round(perTxUsd * 100));
  const capMinor = Math.min(dailyCents, Math.max(1, Math.floor(dailyCents * 0.25), perTxCents));
  const config = burstConfigFrom({
    capMinor,
    refillMinorPerPeriod: Math.max(1, dailyCents),
    refillPeriodSeconds: 24 * 3600,
  });
  return burstUsage({ namespace: "agent:bucket:" + keyId, config });
}

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
  it("the BURST bound, not the daily cap, limits 10 simultaneous $20 requests", async () => {
    const keyId = await agentWithBudget(50, 25);

    // The scenario exactly as specified: fired together, not in sequence.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 20, category: "x402" })
      )
    );

    const allowed = results.filter((r) => r.allowed);

    // THIS NUMBER CHANGED FROM 2 TO 1, AND THAT IS THE FIX RATHER THAN A
    // REGRESSION. The burst cap for this policy is max(25% of $50, $25) = $25
    // within a 12-hour window, and two $20 payments are $40. Previously the
    // bucket was read-modify-write, so all ten concurrent calls read a full
    // bucket, the bound contributed NOTHING, and the daily cap alone admitted
    // two. The reservation is now atomic (lib/agent/burstWindow.ts), so the
    // burst bound actually binds.
    expect(allowed.length * 20).toBeLessThanOrEqual(50);
    expect(allowed).toHaveLength(1);

    // And the refusals name the bound that fired, so an operator can tell a rate
    // limit ("wait") from an exhausted budget ("done for today").
    const denials = results.filter((r) => !r.allowed);
    expect(denials).toHaveLength(9);
    for (const d of denials) {
      if (!d.allowed) expect(d.reason).toBe("burst_rate_exceeded");
    }
  });

  it("refunds the over-reservation so the DAILY budget is not stranded", async () => {
    const keyId = await agentWithBudget(50, 25);

    // Ten concurrent $20 attempts. Each briefly reserves $20 on the atomic daily
    // counter; the ones that do not fit must give it back. If the refund did not
    // happen the counter would sit at $200 and the rest of the day would be
    // unusable.
    await Promise.all(
      Array.from({ length: 10 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 20, category: "x402" })
      )
    );

    // THE ASSERTION IS ON THE REASON, NOT ON SUCCESS, and deliberately so. The
    // burst window is now nearly full ($20 of a $25 cap), so a further $10 is
    // legitimately rate-limited -- that is the burst bound working, not a
    // stranded budget. What proves the DAILY refund happened is WHICH bound
    // fires: an un-refunded day would read $200 and answer
    // daily_budget_exceeded. It answers burst_rate_exceeded instead.
    const next = await authorizeAgentSpend({ keyId, amountUsd: 10, category: "x402" });
    expect(next.allowed).toBe(false);
    if (!next.allowed) {
      expect(next.reason).toBe("burst_rate_exceeded");
      expect(next.reason).not.toBe("daily_budget_exceeded");
    }

    // Proven directly as well, on a policy whose burst cap does not narrow the
    // day (perTx >= daily, so the burst gate is skipped): the full budget spends
    // and the day is what finally refuses.
    const wide = await registerOwnedAgentKey({
      userId: "user_refund_probe",
      name: "Wide policy",
      publicKeyPem: PEM.replace(
        "7VgMPmEwYcAQPHtGY7ZDPYCPX3FjJ0i8sJ0zdiV6XNw",
        "5TgLOmDwXbAPOGsFX6YCOXBOW2EiI9h7rI9ycgU5WMv"
      ),
      policy: { perTxLimitUsd: 20, dailyBudgetUsd: 20, allowedCategories: ["x402"] },
    });
    await Promise.all(
      Array.from({ length: 10 }, () =>
        authorizeAgentSpend({ keyId: wide.keyId, amountUsd: 20, category: "x402" })
      )
    );
    const after = await authorizeAgentSpend({ keyId: wide.keyId, amountUsd: 20, category: "x402" });
    expect(after.allowed).toBe(false);
    if (!after.allowed) expect(after.reason).toBe("daily_budget_exceeded");
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
  // ── Regressions: the burst bucket must not become a lockout ──────────────
  //
  // Both of these failed when the leaky-bucket burst bound was first wired into
  // authorizeAgentSpend, and both are availability defects rather than
  // overspend defects — which is exactly why a suite focused on "can the budget
  // be exceeded" did not describe them.

  it("REGRESSION: a transaction at the per-transaction limit is not permanently denied", async () => {
    // The burst cap was a flat 25% of the daily budget, so on a $50/day policy
    // nothing above $12.50 could EVER clear the bucket — decayingAllowance
    // reports retryAtMs=null for amount > cap, meaning waiting never helps. A
    // configured perTxLimitUsd of $25 was therefore unreachable, and the denial
    // came back as `burst_rate_exceeded`, which invites a retry that cannot
    // succeed. The cap now admits at least one full-size transaction.
    const keyId = await agentWithBudget(50, 25);
    const first = await authorizeAgentSpend({ keyId, amountUsd: 25, category: "x402" });
    expect(first.allowed).toBe(true);
    if (!first.allowed) expect(first.reason).toBeUndefined();
  });

  it("REGRESSION: a transaction far above 25% of the daily budget still clears", async () => {
    // $40 is 80% of the day and equals the per-transaction limit.
    const keyId = await agentWithBudget(50, 40);
    const spend = await authorizeAgentSpend({ keyId, amountUsd: 40, category: "x402" });
    expect(spend.allowed).toBe(true);
  });

  it("REGRESSION: refused attempts return their burst reservation", async () => {
    // The bound is reserved BEFORE the daily counter is consulted. Without a
    // refund, an authorization the daily counter refuses would still consume
    // burst allowance permanently -- so payments that moved no money reduce
    // future capacity, and anything able to provoke denials (including the agent
    // looping) locks the key out. services/velocity.ts and
    // services/policyEngine.ts state the same rule: only money that actually
    // moved may count against a limit.
    const keyId = await agentWithBudget(50, 25);

    // 30 attempts at exactly the burst cap. One can be funded; the other 29 must
    // each give their reservation back, or the window is permanently poisoned.
    await Promise.all(
      Array.from({ length: 30 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 25, category: "x402" })
      )
    );

    // Un-refunded, the window would read $750 and nothing would clear it for 12
    // hours. It holds at most the cap.
    const usage = await burstUsageFor(keyId, 50, 25);
    expect(usage.usedMinor).toBeLessThanOrEqual(usage.capMinor);
    expect(usage.usedMinor).toBeGreaterThan(0);
  });

  it("REGRESSION: a rejected category consumes NO burst allowance at all", async () => {
    // The same lockout by a different door: a policy violation is refused before
    // any reservation is made, so it cannot drain the window.
    const keyId = await agentWithBudget(50, 25);
    await Promise.all(
      Array.from({ length: 20 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 25, category: "transfer" })
      )
    );
    expect((await burstUsageFor(keyId, 50, 25)).usedMinor).toBe(0);

    const legitimate = await authorizeAgentSpend({ keyId, amountUsd: 25, category: "x402" });
    expect(legitimate.allowed).toBe(true);
  });

});
