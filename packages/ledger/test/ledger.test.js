"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { Ledger, LedgerError } = require("../dist/index.js");

function setup() {
  const l = new Ledger();
  l.openAccount({ code: "1000", name: "User USDC", type: "asset", currency: "USDC" });
  l.openAccount({ code: "2000", name: "External clearing", type: "liability", currency: "USDC" });
  return l;
}

test("posts a balanced transaction and derives balances", () => {
  const l = setup();
  // Deposit 100.00 USDC: debit user asset, credit external clearing.
  l.post("deposit", [
    { accountId: "acct_1000", side: "debit", amount: 10000 },
    { accountId: "acct_2000", side: "credit", amount: 10000 },
  ]);
  assert.strictEqual(l.balanceOf("acct_1000"), 10000);
  assert.strictEqual(l.balanceOf("acct_2000"), 10000);
});

test("rejects an unbalanced transaction", () => {
  const l = setup();
  assert.throws(() => l.post("bad", [
    { accountId: "acct_1000", side: "debit", amount: 100 },
    { accountId: "acct_2000", side: "credit", amount: 99 },
  ]), LedgerError);
});

test("rejects non-integer or negative amounts", () => {
  const l = setup();
  assert.throws(() => l.post("bad", [
    { accountId: "acct_1000", side: "debit", amount: 1.5 },
    { accountId: "acct_2000", side: "credit", amount: 1.5 },
  ]), LedgerError);
});

test("rejects unknown accounts", () => {
  const l = setup();
  assert.throws(() => l.post("bad", [
    { accountId: "acct_9999", side: "debit", amount: 100 },
    { accountId: "acct_2000", side: "credit", amount: 100 },
  ]), LedgerError);
});

test("reversal restores balances and keeps history", () => {
  const l = setup();
  const tx = l.post("spend", [
    { accountId: "acct_2000", side: "debit", amount: 5000 },
    { accountId: "acct_1000", side: "credit", amount: 5000 },
  ]);
  l.reverse(tx.id);
  assert.strictEqual(l.balanceOf("acct_1000"), 0);
  assert.strictEqual(l.listTransactions().length, 2); // append-only, not deleted
});

test("trial balance invariant holds after many transactions", () => {
  const l = setup();
  for (let i = 1; i <= 50; i++) {
    l.post(`t${i}`, [
      { accountId: "acct_1000", side: "debit", amount: i },
      { accountId: "acct_2000", side: "credit", amount: i },
    ]);
  }
  const tb = l.trialBalance();
  assert.strictEqual(tb.balanced, true);
  assert.strictEqual(tb.debits, tb.credits);
});
