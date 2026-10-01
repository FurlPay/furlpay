import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import {
  applyFinancialEffect,
  effectTxId,
  ledger,
  movementPostings,
  __resetAppliedEffectsForTests,
} from "../ledger";
import { findOrCreateUserByIdentity, getAccount, InsufficientBalanceError } from "../store";
import { creditAccount, debitAccount, getAccountBalanceUsd } from "../services/account";

// ---------------------------------------------------------------------------
// applyFinancialEffect and its callers, in the dev/test path (no Postgres).
// Same contract as the SQL function proven on real PostgreSQL 18 by
// scripts/db/verify-financial-effects.mjs: one effect per key, refused effects
// leave no trace, balance and ledger move together.
// ---------------------------------------------------------------------------

const user = () => findOrCreateUserByIdentity({ email: `fx-${randomUUID()}@furlpay.test` }).account.user.id;
const usdc = (id: string) =>
  getAccount(id)!.tokenBalances.find((b) => b.token === "USDC" && b.chain === "arbitrum")?.amount ?? 0;

beforeEach(() => __resetAppliedEffectsForTests());

describe("applyFinancialEffect", () => {
  it("applies once per key; the repeat moves nothing and reports applied=false", async () => {
    const id = user();
    const effect = () => ({
      effectKey: `test:${id}:1`,
      memo: "credit",
      ...movementPostings("in", 12.5, id),
      balanceDeltas: [{ userId: id, token: "USDC" as const, chain: "arbitrum" as const, amount: "12.50", usdValue: "12.50" }],
    });
    const a = await applyFinancialEffect(effect());
    const b = await applyFinancialEffect(effect());
    expect(a).toEqual({ applied: true, ledgerTxId: effectTxId(`test:${id}:1`) });
    expect(b).toEqual({ applied: false, ledgerTxId: effectTxId(`test:${id}:1`) });
    expect(usdc(id)).toBe(12.5);
    expect(ledger.getTransaction(effectTxId(`test:${id}:1`))).toBeDefined();
  });

  it("the transaction id matches the SQL ('lx_' || md5(key))", () => {
    expect(effectTxId("abc")).toBe("lx_900150983cd24fb0d6963f7d28e17f72");
  });

  it("an overdraft is refused and leaves no ledger entry and no balance change", async () => {
    const id = user();
    const key = `test:${id}:overdraft`;
    await expect(
      applyFinancialEffect({
        effectKey: key,
        memo: "spend",
        ...movementPostings("out", 5, id),
        balanceDeltas: [{ userId: id, token: "USDC", chain: "arbitrum", amount: "-5.00", usdValue: "-5.00" }],
      })
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
    expect(ledger.getTransaction(effectTxId(key))).toBeUndefined();
    expect(usdc(id)).toBe(0);
  });

  it("refuses an empty key and non-decimal deltas", async () => {
    const id = user();
    await expect(applyFinancialEffect({ effectKey: " ", memo: "x", ...movementPostings("in", 1, id) })).rejects.toThrow(/effect key/);
    await expect(
      applyFinancialEffect({
        effectKey: `k:${id}`,
        memo: "x",
        ...movementPostings("in", 1, id),
        balanceDeltas: [{ userId: id, token: "USDC", chain: "arbitrum", amount: "1e3", usdValue: "1000" }],
      })
    ).rejects.toThrow(/decimal strings/);
  });

  it("100 interleaved credits/debits: balance == sum of applied deltas == ledger", async () => {
    const id = user();
    await creditAccount(id, 1000, "open", undefined, `open:${id}`);
    let expected = 100_000;
    const ops = Array.from({ length: 100 }, (_, i) => ({ cents: 100 + ((i * 37) % 900), dir: i % 3 === 0 ? "out" : "in" }));
    await Promise.all(
      ops.map((o, i) =>
        o.dir === "in"
          ? creditAccount(id, o.cents / 100, "c", undefined, `op:${id}:${i}`)
          : debitAccount(id, o.cents / 100, "d", undefined, `op:${id}:${i}`)
      )
    );
    for (const o of ops) expected += o.dir === "in" ? o.cents : -o.cents;
    expect(Math.round(getAccountBalanceUsd(id) * 100)).toBe(expected);
    const liability = ledger.balanceOf(`acct_2000_${id}`);
    expect(liability).toBe(expected);
  });
});

describe("creditAccount / debitAccount", () => {
  it("a retried credit with the same key is a duplicate, not a second credit", async () => {
    const id = user();
    const first = await creditAccount(id, 20, "fund", undefined, `x402-fund:base:0xabc:0x01:${id}`);
    const again = await creditAccount(id, 20, "fund", undefined, `x402-fund:base:0xabc:0x01:${id}`);
    expect(first).toMatchObject({ ok: true, duplicate: false, balanceUsd: 20 });
    expect(again).toMatchObject({ ok: true, duplicate: true, balanceUsd: 20 });
    expect(getAccount(id)!.transactions.filter((t) => t.title === "fund")).toHaveLength(1);
  });

  it("a debit beyond the balance is insufficient_balance and moves nothing", async () => {
    const id = user();
    await creditAccount(id, 5, "fund", undefined, `f:${id}`);
    const r = await debitAccount(id, 9, "spend", undefined, `s:${id}`);
    expect(r).toMatchObject({ ok: false, error: "insufficient_balance", balanceUsd: 5 });
  });
});
