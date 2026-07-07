import { db, newTx, recordTransaction } from "@/lib/store";

// ---------------------------------------------------------------------------
// FurlPay account balance — the spendable USDC balance the funding loop feeds.
// This is the moat: an x402 payment doesn't just transfer once, it *funds a
// FurlPay account* that can then be spent on travel, cards and payouts. The
// canonical balance is native USDC on Arbitrum One (the settlement rail).
// Backed by db.tokenBalances so it shows up everywhere balances render.
// ---------------------------------------------------------------------------

const ACCOUNT_TOKEN = "USDC" as const;
const ACCOUNT_CHAIN = "arbitrum" as const;

function accountEntry() {
  let entry = db.tokenBalances.find((b) => b.token === ACCOUNT_TOKEN && b.chain === ACCOUNT_CHAIN);
  if (!entry) {
    entry = { token: ACCOUNT_TOKEN, chain: ACCOUNT_CHAIN, amount: 0, usdValue: 0 };
    db.tokenBalances.push(entry);
  }
  return entry;
}

export function getAccountBalanceUsd(): number {
  return round(accountEntry().amount);
}

/** Credit the FurlPay account (e.g. after an x402 funding settles). */
export function creditAccount(amountUsd: number, memo: string, subtitle?: string): number {
  const entry = accountEntry();
  entry.amount = round(entry.amount + amountUsd);
  entry.usdValue = entry.amount;
  recordTransaction(
    newTx({
      category: "transfer",
      direction: "in",
      title: memo,
      subtitle: subtitle ?? "Funded via x402 · Arbitrum One",
      amountUsd,
      token: ACCOUNT_TOKEN,
      chain: ACCOUNT_CHAIN,
      status: "settled",
    })
  );
  return round(entry.amount);
}

export interface DebitResult {
  ok: boolean;
  balanceUsd: number;
  error?: string;
}

/** Spend from the FurlPay account balance (booking, payout, card top-up). */
export function debitAccount(amountUsd: number, memo: string, subtitle?: string): DebitResult {
  const entry = accountEntry();
  if (amountUsd <= 0) return { ok: false, balanceUsd: round(entry.amount), error: "invalid_amount" };
  if (entry.amount + 1e-9 < amountUsd) {
    return { ok: false, balanceUsd: round(entry.amount), error: "insufficient_balance" };
  }
  entry.amount = round(entry.amount - amountUsd);
  entry.usdValue = entry.amount;
  recordTransaction(
    newTx({
      category: "transfer",
      direction: "out",
      title: memo,
      subtitle: subtitle ?? "Spent from FurlPay balance · Arbitrum One",
      amountUsd,
      token: ACCOUNT_TOKEN,
      chain: ACCOUNT_CHAIN,
      status: "settled",
    })
  );
  return { ok: true, balanceUsd: round(entry.amount) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
