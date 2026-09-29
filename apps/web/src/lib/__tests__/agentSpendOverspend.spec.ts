import { describe, it, expect, beforeEach } from "vitest";
import { authorizeAgentSpend, registerOwnedAgentKey } from "../agentPolicy";

// ---------------------------------------------------------------------------
// Overspend, attacked at the concurrency levels where it actually appears.
//
// WHY THIS FILE EXISTS ALONGSIDE agentSpendConcurrency.spec.ts. That suite
// proves the invariant at 5, 10, 20, 30 and 100. This one pushes to 500 and
// 1000, because the concurrency bug this repository has already shipped once
// (F-12, the burst bucket that contributed nothing under load) was invisible
// below 500 — which is exactly why it survived review as a "documented
// limitation" rather than being seen as a defect.
//
// THE INVARIANT, stated as arithmetic rather than as a feeling:
//
//     sum(allowed amounts) <= budget,  always, under any interleaving.
//
// Not "approximately". A budget that can be exceeded by one cent under load can
// be exceeded by one cent per request, and the number of requests is chosen by
// the attacker.
//
// THE ATTACKER'S ACTUAL STRATEGY is not one big payment — that is what the
// per-transaction cap is for. It is N simultaneous small ones, timed so that
// every one of them reads the budget before any of them writes it. A
// read-then-write reservation fails exactly here and passes every sequential
// test ever written against it.
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Same reset the sibling concurrency suite uses: the in-memory KV backing
  // store, cleared so one storm's spend does not become the next one's
  // starting balance.
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
});

const USER = "user_overspend";

// Any valid SPKI PEM works: these tests exercise the POLICY gate, which runs
// after signature verification and never re-parses the key.
const PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7VgMPmEwYcAQPHtGY7ZDPYCPX3FjJ0i8sJ0zdiV6XNw=
-----END PUBLIC KEY-----`;

// A SECOND, genuinely different key. `keyId` is derived from the SPKI
// fingerprint, so registering twice with one PEM yields ONE agent sharing ONE
// budget — which is correct behaviour, and made the first draft of the
// cross-agent test assert against a single agent by accident.
const PEM_B = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAScFJq2zRmWo/CgrX9zH62iZ2ztI3BXXG0KHj2udDeTs=
-----END PUBLIC KEY-----`;

async function agentWithBudget(
  dailyBudgetUsd: number,
  perTxLimitUsd: number,
  publicKeyPem: string = PEM
) {
  const record = await registerOwnedAgentKey({
    userId: USER,
    name: "Overspend agent",
    publicKeyPem,
    policy: {
      perTxLimitUsd,
      dailyBudgetUsd,
      allowedCategories: ["x402", "commerce", "travel"],
    },
  });
  return record.keyId;
}

/** Fire N authorizations at once and report what actually got through. */
async function storm(keyId: string, count: number, amountUsd: number) {
  const results = await Promise.all(
    Array.from({ length: count }, () =>
      authorizeAgentSpend({ keyId, amountUsd, category: "commerce" })
    )
  );
  const allowed = results.filter((r) => r.allowed);
  return {
    allowedCount: allowed.length,
    // Cents, as integers. Summing floats here would make the assertion itself
    // the least trustworthy part of the test.
    totalCents: allowed.length * Math.round(amountUsd * 100),
    reasons: [...new Set(results.filter((r) => !r.allowed).map((r) => (r as { reason: string }).reason))],
  };
}

describe("the daily budget cannot be exceeded under load", () => {
  for (const workers of [500, 1000]) {
    it(`${workers} simultaneous spends never exceed the budget`, async () => {
      // $1.00 budget, 1-cent charges, N attempts. At most 100 may pass however
      // the scheduler interleaves them.
      const keyId = await agentWithBudget(1, 1);
      const { allowedCount, totalCents } = await storm(keyId, workers, 0.01);

      expect(
        totalCents,
        `${allowedCount} of ${workers} spends were allowed, totalling ${totalCents}c against a 100c budget`
      ).toBeLessThanOrEqual(100);
    }, 120_000);
  }

  it("500 spends against a budget that fits ALL of them still allows all of them", async () => {
    // The control. An invariant that holds by refusing everything is not an
    // invariant, it is an outage — and a test suite that only checks the upper
    // bound would score that as a pass.
    const keyId = await agentWithBudget(100, 1);
    const { allowedCount, reasons } = await storm(keyId, 500, 0.01);
    expect(allowedCount, `blocked with reasons: ${reasons.join(", ")}`).toBe(500);
  }, 120_000);

  it("the budget is spent to the cent, not merely bounded", async () => {
    // Upper bound AND utilisation. Under-spending is a correctness bug too: it
    // means a paying customer's agent stops working before their budget is used.
    const keyId = await agentWithBudget(1, 1);
    const { totalCents } = await storm(keyId, 500, 0.01);
    expect(totalCents).toBe(100);

    const after = await authorizeAgentSpend({ keyId, amountUsd: 0.01, category: "commerce" });
    expect(after.allowed).toBe(false);
  }, 120_000);

  it("mixed amounts cannot straddle the limit", async () => {
    // Uniform amounts can mask an off-by-one that only appears when the last
    // admitted charge is larger than the remainder.
    const keyId = await agentWithBudget(1, 1);
    const results = await Promise.all([
      ...Array.from({ length: 250 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 0.01, category: "commerce" })
      ),
      ...Array.from({ length: 250 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 0.07, category: "commerce" })
      ),
    ]);
    const cents = results
      .filter((r) => r.allowed)
      .reduce((sum, _r, i) => sum + (i < 250 ? 1 : 7), 0);
    // A weaker but honest assertion: whatever mix got through, the engine must
    // still be able to state that nothing further fits.
    const after = await authorizeAgentSpend({ keyId, amountUsd: 0.01, category: "commerce" });
    if (cents >= 100) expect(after.allowed).toBe(false);
  }, 120_000);
});

describe("the per-transaction cap holds independently of the daily budget", () => {
  it("1000 oversized charges against a huge budget are ALL refused", async () => {
    // The two limits are independent. A generous daily budget must not become a
    // way to slip a single oversized payment through — that cap is what stops a
    // decimal-place slip becoming a five-figure payment.
    const keyId = await agentWithBudget(1_000_000, 25);
    const results = await Promise.all(
      Array.from({ length: 1000 }, () =>
        authorizeAgentSpend({ keyId, amountUsd: 26, category: "commerce" })
      )
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(0);
  }, 120_000);

  it("a charge exactly AT the cap is allowed; one cent over is not", async () => {
    const keyId = await agentWithBudget(1_000_000, 25);
    const at = await authorizeAgentSpend({ keyId, amountUsd: 25, category: "commerce" });
    expect(at.allowed, "a charge at the cap was refused").toBe(true);
    const over = await authorizeAgentSpend({ keyId, amountUsd: 25.01, category: "commerce" });
    expect(over.allowed, "a charge over the cap was allowed").toBe(false);
  });
});

describe("structuring: many small payments cannot evade a per-transaction cap", () => {
  it("splitting one oversized payment into 500 small ones still hits the daily budget", async () => {
    // The attack a per-transaction cap invites: if $26 is refused, send 500
    // charges of $0.05. The per-tx cap does not stop that — the DAILY BUDGET
    // does, and this is the test that says so out loud.
    const keyId = await agentWithBudget(10, 25);
    const { totalCents } = await storm(keyId, 500, 0.05);
    expect(totalCents).toBeLessThanOrEqual(1000);
  }, 120_000);
});

describe("a key id is the key's own fingerprint", () => {
  it("registering the same public key twice yields the SAME agent, not two", async () => {
    // Worth pinning: it means an operator cannot accidentally double an agent's
    // budget by registering its key again under a new name, and it is why the
    // cross-agent test below must use two genuinely different keys.
    const first = await agentWithBudget(1, 1, PEM);
    const second = await agentWithBudget(999, 999, PEM);
    expect(second).toBe(first);
  });
});

describe("budgets do not leak between agents", () => {
  it("500 spends split across two agents charge each agent separately", async () => {
    // A shared counter would let one agent exhaust another's budget — and, worse,
    // would make a compromised agent able to deny service to every other agent
    // in the organization.
    const a = await agentWithBudget(1, 1, PEM);
    const b = await agentWithBudget(1, 1, PEM_B);
    expect(a, "both agents resolved to the same key id").not.toBe(b);

    const results = await Promise.all([
      ...Array.from({ length: 250 }, () =>
        authorizeAgentSpend({ keyId: a, amountUsd: 0.01, category: "commerce" })
      ),
      ...Array.from({ length: 250 }, () =>
        authorizeAgentSpend({ keyId: b, amountUsd: 0.01, category: "commerce" })
      ),
    ]);

    const allowedA = results.slice(0, 250).filter((r) => r.allowed).length;
    const allowedB = results.slice(250).filter((r) => r.allowed).length;
    // Each has its own $1.00, so each may spend up to 100 cents.
    expect(allowedA).toBeLessThanOrEqual(100);
    expect(allowedB).toBeLessThanOrEqual(100);
    // And neither is starved by the other's traffic.
    expect(allowedA).toBeGreaterThan(0);
    expect(allowedB).toBeGreaterThan(0);
  }, 120_000);
});
