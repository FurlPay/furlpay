import { NextResponse } from "next/server";
import { capabilityOr503, capabilityUnavailable } from "@/lib/capabilityGate";
import { getAccount, newTx, recordTransaction } from "@/lib/store";
import type { Token } from "@/lib/types";

// ---------------------------------------------------------------------------
// The crypto leg of a P2P trade: lock the seller's asset into escrow at order
// creation, hand it to the buyer on release, hand it back on cancel.
//
// This is the DEMO ledger — it moves in-memory balances, not coins. Same
// posture as wallets/transfer: production refuses rather than recording a
// settled trade that never happened. No P2P order may report "released" in
// prod until a real settlement path exists behind it.
// ---------------------------------------------------------------------------

/**
 * The P2P marketplace gate — EVERY P2P handler calls it, not only the ones
 * that move escrow.
 *
 * It used to guard just create/release/cancel. Ads, saved payment methods
 * (bank account numbers, UPI handles), quotes, appeals, ratings and the order
 * book all served in production from process memory: a user could post an ad
 * or save their bank details on one serverless instance and find them gone on
 * the next request. P2P_LIVE (lib/flags.ts, `unimplemented`) now closes the
 * whole surface.
 *
 * TWO conditions, either of which refuses: the capability gate (financial
 * environment + flag), AND any production build (NODE_ENV). The second is the
 * original guard, kept so preview deployments — production builds that
 * financialEnvironment() classifies as development — stay closed as before.
 */
export function p2pSettlementUnavailable(): NextResponse | null {
  const gated = capabilityOr503("P2P_LIVE", "The P2P marketplace");
  if (gated) return gated;
  if (process.env.NODE_ENV === "production") return capabilityUnavailable("P2P_LIVE", "The P2P marketplace");
  return null;
}

/** Alias used by the non-settlement P2P routes; same gate. */
export const p2pUnavailable = p2pSettlementUnavailable;

export class InsufficientFunds extends Error {
  constructor() {
    super("insufficient_balance");
  }
}

/**
 * Move `amount` of `asset` out of a user's spendable balance. Used to fund
 * escrow at order creation — the seller cannot spend what is already locked.
 */
export function debitAsset(userId: string, asset: Token, amount: number): void {
  const account = getAccount(userId);
  if (!account) throw new InsufficientFunds();
  const bal = account.tokenBalances.find((b) => b.token === asset);
  // Float epsilon: a balance of exactly the trade size must not fail on the
  // last binary digit.
  if (!bal || bal.amount + 1e-9 < amount) throw new InsufficientFunds();

  const perUnit = bal.amount > 0 ? bal.usdValue / bal.amount : 0;
  bal.amount = round8(bal.amount - amount);
  bal.usdValue = round2(bal.usdValue - amount * perUnit);
}

/** Return escrowed asset to its owner (order cancelled, or appeal resolved). */
export function creditAsset(userId: string, asset: Token, amount: number, unitUsd: number): void {
  const account = getAccount(userId);
  if (!account) return;
  const bal = account.tokenBalances.find((b) => b.token === asset);
  if (bal) {
    bal.amount = round8(bal.amount + amount);
    bal.usdValue = round2(bal.usdValue + amount * unitUsd);
    return;
  }
  account.tokenBalances.push({
    token: asset,
    chain: "arbitrum",
    amount: round8(amount),
    usdValue: round2(amount * unitUsd),
  });
}

/** What one unit of the asset is worth to this account, for crediting USD value. */
export function unitUsdFor(userId: string, asset: Token): number {
  const account = getAccount(userId);
  const bal = account?.tokenBalances.find((b) => b.token === asset);
  if (bal && bal.amount > 0) return bal.usdValue / bal.amount;
  // Stablecoins are par; anything else without a priced balance credits 0 USD
  // value rather than inventing a price.
  return asset === "USDT" || asset === "USDC" ? 1 : 0;
}

export function recordP2PTransaction(
  userId: string,
  params: {
    direction: "in" | "out";
    title: string;
    subtitle: string;
    amountUsd: number;
    token: Token;
    status: "pending" | "settled" | "escrow";
  },
): void {
  recordTransaction(
    userId,
    newTx({
      category: "transfer",
      direction: params.direction,
      title: params.title,
      subtitle: params.subtitle,
      amountUsd: params.amountUsd,
      token: params.token,
      chain: "arbitrum",
      status: params.status,
    }),
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
