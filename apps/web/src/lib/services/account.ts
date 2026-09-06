import { getAccount, newTx, recordTransaction, DEMO_USER_ID } from "@/lib/store";
import { recordMovement, usdToCents } from "@/lib/ledger";
import { log } from "@/lib/log";

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
  let entry = account.tokenBalances.find((b) => b.token === ACCOUNT_TOKEN && b.chain === ACCOUNT_CHAIN);
  if (!entry) {
    entry = { token: ACCOUNT_TOKEN, chain: ACCOUNT_CHAIN, amount: 0, usdValue: 0 };
    account.tokenBalances.push(entry);
  }
  return entry;
}

export function getAccountBalanceUsd(userId: string = DEMO_USER_ID): number {
  const entry = accountEntry(userId);
  return entry ? centsToUsd(usdToCents(entry.amount)) : 0;
}

export interface CreditResult {
  ok: boolean;
  balanceUsd: number;
  error?: string;
}

/** Credit the FurlPay account (e.g. after an x402 funding settles).
 *
 *  Async because the ledger posting is durable: the balance must not move
 *  until Postgres has accepted the balanced entry. */
export async function creditAccount(
  userId: string,
  amountUsd: number,
  memo: string,
  subtitle?: string
): Promise<CreditResult> {
  const entry = accountEntry(userId);
  if (!entry) return { ok: false, balanceUsd: 0, error: "account_not_found" };

  let cents: number;
  try {
    cents = usdToCents(amountUsd);
  } catch {
    return { ok: false, balanceUsd: centsToUsd(usdToCents(entry.amount)), error: "invalid_amount" };
  }
  if (cents <= 0) return { ok: false, balanceUsd: centsToUsd(usdToCents(entry.amount)), error: "invalid_amount" };

  // Ledger first: if the balanced posting fails, the balance must not move.
  try {
    await recordMovement("in", centsToUsd(cents), memo, userId);
  } catch (e) {
    log.error("creditAccount ledger posting failed", { userId, amountUsd, error: (e as Error).message });
    return { ok: false, balanceUsd: centsToUsd(usdToCents(entry.amount)), error: "ledger_error" };
  }

  const newCents = usdToCents(entry.amount) + cents;
  entry.amount = centsToUsd(newCents);
  entry.usdValue = entry.amount;
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
  return { ok: true, balanceUsd: entry.amount };
}

export interface DebitResult {
  ok: boolean;
  balanceUsd: number;
  error?: string;
}

/** Spend from the FurlPay account balance (booking, payout, card top-up). */
export async function debitAccount(
  userId: string,
  amountUsd: number,
  memo: string,
  subtitle?: string
): Promise<DebitResult> {
  const entry = accountEntry(userId);
  if (!entry) return { ok: false, balanceUsd: 0, error: "account_not_found" };

  let cents: number;
  try {
    cents = usdToCents(amountUsd);
  } catch {
    return { ok: false, balanceUsd: centsToUsd(usdToCents(entry.amount)), error: "invalid_amount" };
  }
  const balanceCents = usdToCents(entry.amount);
  if (cents <= 0) return { ok: false, balanceUsd: centsToUsd(balanceCents), error: "invalid_amount" };
  if (balanceCents < cents) {
    return { ok: false, balanceUsd: centsToUsd(balanceCents), error: "insufficient_balance" };
  }

  try {
    await recordMovement("out", centsToUsd(cents), memo, userId);
  } catch (e) {
    log.error("debitAccount ledger posting failed", { userId, amountUsd, error: (e as Error).message });
    return { ok: false, balanceUsd: centsToUsd(balanceCents), error: "ledger_error" };
  }

  entry.amount = centsToUsd(balanceCents - cents);
  entry.usdValue = entry.amount;
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
  return { ok: true, balanceUsd: entry.amount };
}

function centsToUsd(cents: number): number {
  return Math.round(cents) / 100;
}
