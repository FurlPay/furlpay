import { test } from "node:test";
import assert from "node:assert/strict";
import { settlementPolicy } from "./settlement-policy.js";

// ---------------------------------------------------------------------------
// The settlement policy, on the running path.
//
// These assert the things the gateway's built-in `requiredConfirmations` could
// not express, because it never knew which chain it was on:
//
//   - the same amount needs a different confirmation count per chain
//   - a large payment on an optimistic rollup is UNSATISFIABLE by waiting
//   - Alpenglow's timing applies only when it has been OBSERVED, never on a date
//
// The third is the one with a deadline attached, and the deadline turns out not
// to matter: the mechanism is evidence-driven by design, so nothing changes at
// midnight on 28 September.
// ---------------------------------------------------------------------------

const USDC = 6;
const usd = (n: number) => String(Math.round(n * 10 ** USDC));

test("the same amount implies a different WAIT on each chain", () => {
  // At this tier every chain needs one confirmation — the count is the same
  // and correctly so. What differs is how long that confirmation takes:
  // ~400ms on Solana, ~2s on Base, ~250ms on Arbitrum. That is precisely what
  // a chain-blind confirmation count cannot express, and why the old
  // `requiredConfirmations(amount)` was the wrong shape rather than merely
  // the wrong numbers.
  const p = settlementPolicy();
  const waits = ["solana:mainnet-beta", "base:mainnet", "arbitrum:mainnet"].map(
    (network) => p.forPayment({ amountAtomic: usd(5), decimals: USDC, network }).expectedWaitMs
  );

  for (const w of waits) assert.ok(w !== null && w > 0);
  assert.equal(new Set(waits).size, waits.length, `expected three distinct waits, got ${waits}`);
});

test("a small payment releases on confirmation, not finality", () => {
  const p = settlementPolicy();
  const v = p.forPayment({ amountAtomic: usd(0.001), decimals: USDC, network: "solana:mainnet-beta" });
  assert.equal(v.unsatisfiable, false);
  assert.equal(v.tier, "instant");
  // Confirmation on Solana is ~400ms, so this must not be demanding 12.8s.
  assert.ok(v.expectedWaitMs !== null && v.expectedWaitMs <= 1_000, `waited ${v.expectedWaitMs}ms`);
});

test("a high-value payment on an optimistic rollup is unsatisfiable by waiting", () => {
  // THE CASE THE OLD CODE COULD NOT REPRESENT. Arbitrum's withdrawal finality
  // sits behind a seven-day fraud-proof window, so a tier that requires
  // finality is not reached by waiting longer — at 12 confirmations or at
  // 12,000. The gateway used to wait for its fixed count and then release.
  const p = settlementPolicy();
  const v = p.forPayment({ amountAtomic: usd(50_000), decimals: USDC, network: "arbitrum:mainnet" });

  assert.equal(v.unsatisfiable, true);
  assert.equal(v.expectedWaitMs, null, "null means cannot wait for this, not zero");
  assert.match(v.explanation, /./);
});

test("Alpenglow timing is NOT applied on a date", () => {
  // The published gate opens 2026-09-28. With no observation, the policy must
  // still plan against TowerBFT (~12.8s) — a calendar is a plan, and releasing
  // money faster because a date passed is how a slipped release becomes an
  // incident.
  const p = settlementPolicy();
  const v = p.forPayment({ amountAtomic: usd(500), decimals: USDC, network: "solana:mainnet-beta" });

  assert.equal(v.unsatisfiable, false);
  assert.ok(
    v.expectedWaitMs !== null && v.expectedWaitMs >= 10_000,
    `unobserved Alpenglow must still plan against TowerBFT, got ${v.expectedWaitMs}ms`
  );
});

test("Alpenglow timing IS applied once a certificate is observed", () => {
  // A Votor certificate is the consensus, not a hint about it. This is the only
  // kind of thing that may shorten the wait.
  const p = settlementPolicy({ observation: { votorCertificateSeen: true } });
  const v = p.forPayment({ amountAtomic: usd(500), decimals: USDC, network: "solana:mainnet-beta" });

  assert.ok(
    v.expectedWaitMs !== null && v.expectedWaitMs < 1_000,
    `observed Alpenglow should plan against ~150ms, got ${v.expectedWaitMs}ms`
  );
});

test("an unmodelled network releases on one confirmation and says so", () => {
  // The example's simulation rail. Inventing a finality claim for a chain that
  // does not exist would be worse than admitting there is no model.
  const p = settlementPolicy();
  const v = p.forPayment({ amountAtomic: usd(1), decimals: USDC, network: "test:local" });
  assert.equal(v.confirmations, 1);
  assert.equal(v.unsatisfiable, false);
  assert.match(v.explanation, /No finality model/i);
});

test("confirmations are never zero for a satisfiable plan", () => {
  // A count of zero would mean releasing before inclusion.
  const p = settlementPolicy();
  for (const network of ["solana:mainnet-beta", "base:mainnet", "polygon:mainnet"]) {
    for (const amount of [0.001, 5, 500]) {
      const v = p.forPayment({ amountAtomic: usd(amount), decimals: USDC, network });
      if (!v.unsatisfiable) {
        assert.ok(v.confirmations >= 1, `${network} @ $${amount} -> ${v.confirmations}`);
      }
    }
  }
});

test("tiers rise with amount rather than staying flat", () => {
  const p = settlementPolicy();
  const small = p.forPayment({ amountAtomic: usd(0.5), decimals: USDC, network: "solana:mainnet-beta" });
  const large = p.forPayment({ amountAtomic: usd(100_000), decimals: USDC, network: "solana:mainnet-beta" });
  assert.notEqual(small.tier, large.tier);
});
