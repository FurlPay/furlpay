import { InsufficientBalanceError, getAccount, newTx, recordTransaction } from "@/lib/store";
import { applyFinancialEffect, movementPostings, usdToCents } from "@/lib/ledger";
import { log } from "@/lib/log";
import { raiseFinancialAlert } from "@/lib/ops/financialAlerts";

// ---------------------------------------------------------------------------
// FurlPay account balance — the spendable USDC balance the funding loop feeds.
// The canonical balance is native USDC on Arbitrum One (the settlement rail).
// Backed by the user's tokenBalances so it shows up everywhere balances
// render, and EVERY credit/debit posts a balanced ledger entry so the stored
// balance can always be reconciled against the derived ledger balance.
//
// Amounts are handled in integer cents internally; the stored balance floats
// are only ever assigned from cents/100, so they can't drift.
// ---------------------------------------------------------------------------

const ACCOUNT_TOKEN = "USDC" as const;
const ACCOUNT_CHAIN = "arbitrum" as const;

function accountEntry(userId: string) {
  const account = getAccount(userId);
  if (!account) return undefined;
  return account.tokenBalances.find((b) => b.token === ACCOUNT_TOKEN && b.chain === ACCOUNT_CHAIN);
}

export function getAccountBalanceUsd(userId: string): number {
  const entry = accountEntry(userId);
  return entry ? centsToUsd(usdToCents(entry.amount)) : 0;
}

export interface CreditResult {
  ok: boolean;
  balanceUsd: number;
  error?: string;
  /** The effect key had already been applied — nothing moved this time. */
  duplicate?: boolean;
}

/** Credit the FurlPay account (e.g. after an x402 funding settles).
 *
 *  EXACTLY ONCE PER EFFECT KEY (audit P0-1/P0-2). The ledger posting and the
 *  balance change commit together in one Postgres transaction
 *  (apply_financial_effect, migration 0025), keyed by `effectKey`. A retry
 *  with the same key moves nothing and reports `duplicate: true`. The key must
 *  come from the provider's own facts (the settled authorization, the
 *  processor reference) — never a random id. */
export async function creditAccount(
  userId: string,
  amountUsd: number,
  memo: string,
  subtitle: string | undefined,
  effectKey: string
): Promise<CreditResult> {
  if (!getAccount(userId)) return { ok: false, balanceUsd: 0, error: "account_not_found" };
  let cents: number;
  try {
    cents = usdToCents(amountUsd);
  } catch {
    return { ok: false, balanceUsd: getAccountBalanceUsd(userId), error: "invalid_amount" };
  }
  if (cents <= 0) return { ok: false, balanceUsd: getAccountBalanceUsd(userId), error: "invalid_amount" };

  const amount = centsToUsd(cents).toFixed(2);
  let result;
  try {
    result = await applyFinancialEffect({
      effectKey,
      memo,
      ...movementPostings("in", centsToUsd(cents), userId),
      balanceDeltas: [{ userId, token: ACCOUNT_TOKEN, chain: ACCOUNT_CHAIN, amount, usdValue: amount }],
    });
  } catch (e) {
    log.error("creditAccount effect failed", { userId, amountUsd, effectKey, error: (e as Error).message });
    void raiseFinancialAlert("financial_effect_failed", { op: "credit", userId, effectKey });
    return { ok: false, balanceUsd: getAccountBalanceUsd(userId), error: "ledger_error" };
  }
  if (result.applied) {
    recordTransaction(
      userId,
      newTx({
        category: "transfer",
        direction: "in",
        title: memo,
        subtitle: subtitle ?? "Funded via x402 · Arbitrum One",
        amountUsd: centsToUsd(cents),
        token: ACCOUNT_TOKEN,
        chain: ACCOUNT_CHAIN,
        status: "settled",
      })
    );
  }
  return { ok: true, balanceUsd: getAccountBalanceUsd(userId), duplicate: !result.applied };
}

export interface DebitResult {
  ok: boolean;
  balanceUsd: number;
  error?: string;
  duplicate?: boolean;
}

/** Spend from the FurlPay account balance (booking, payout, card top-up).
 *  Same exactly-once contract as creditAccount. The overdraft check is done
 *  by the database under a row lock, not by reading this instance's copy. */
export async function debitAccount(
  userId: string,
  amountUsd: number,
  memo: string,
  subtitle: string | undefined,
  effectKey: string
): Promise<DebitResult> {
  if (!getAccount(userId)) return { ok: false, balanceUsd: 0, error: "account_not_found" };
  let cents: number;
  try {
    cents = usdToCents(amountUsd);
  } catch {
    return { ok: false, balanceUsd: getAccountBalanceUsd(userId), error: "invalid_amount" };
  }
  if (cents <= 0) return { ok: false, balanceUsd: getAccountBalanceUsd(userId), error: "invalid_amount" };

  const amount = centsToUsd(cents).toFixed(2);
  let result;
  try {
    result = await applyFinancialEffect({
      effectKey,
      memo,
      ...movementPostings("out", centsToUsd(cents), userId),
      balanceDeltas: [{ userId, token: ACCOUNT_TOKEN, chain: ACCOUNT_CHAIN, amount: `-${amount}`, usdValue: `-${amount}` }],
    });
  } catch (e) {
    const insufficient = e instanceof InsufficientBalanceError || /insufficient/i.test((e as Error).message);
    if (!insufficient) {
      log.error("debitAccount effect failed", { userId, amountUsd, effectKey, error: (e as Error).message });
      void raiseFinancialAlert("financial_effect_failed", { op: "debit", userId, effectKey });
    }
    return {
      ok: false,
      balanceUsd: getAccountBalanceUsd(userId),
      error: insufficient ? "insufficient_balance" : "ledger_error",
    };
  }
  if (result.applied) {
    recordTransaction(
      userId,
      newTx({
        category: "transfer",
        direction: "out",
        title: memo,
        subtitle: subtitle ?? "Spent from FurlPay balance · Arbitrum One",
        amountUsd: centsToUsd(cents),
        token: ACCOUNT_TOKEN,
        chain: ACCOUNT_CHAIN,
        status: "settled",
      })
    );
  }
  return { ok: true, balanceUsd: getAccountBalanceUsd(userId), duplicate: !result.applied };
}

function centsToUsd(cents: number): number {
  return Math.round(cents) / 100;
}
