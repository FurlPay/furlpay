import type { Posting } from "@furlpay/ledger";
import { ACCOUNTS, applyFinancialEffect, usdToCents, userLiabilityAccount, type AccountSpec, type WebhookAck } from "@/lib/ledger";

// ---------------------------------------------------------------------------
// Stripe refunds and chargebacks → the ledger (audit P2-7).
//
// Only `payment_intent.succeeded` was handled, so a refunded or disputed
// funding payment left the customer's ledger liability untouched: the books
// said we owed money Stripe had already clawed back. Every reversal is now its
// own balanced ledger transaction, applied exactly once by an effect key made
// of Stripe's ids (apply_financial_effect, migration 0025):
//
//   refund succeeded      stripe:refund:<re_id>          Dr customer liability / Cr bank escrow
//   dispute opened        stripe:dispute:<dp_id>:opened  Dr customer liability / Cr chargeback liability
//   dispute won           stripe:dispute:<dp_id>:won     Dr chargeback liability / Cr customer liability
//   dispute lost          stripe:dispute:<dp_id>:lost    Dr chargeback liability / Cr bank escrow
//
// A closed dispute first (re)applies the `opened` hold — a no-op if it already
// happened — so an outcome can never draw on a hold that was never recorded.
// Non-USD objects are refused (minor units of another currency are not cents).
// ---------------------------------------------------------------------------

export interface StripeRefundLike {
  id: string;
  amount: number;
  currency: string;
  status?: string | null;
  payment_intent?: string | { id: string } | null;
}
export interface StripeDisputeLike {
  id: string;
  amount: number;
  currency: string;
  status: string;
  payment_intent?: string | { id: string } | null;
}

export type ResolveUser = (paymentIntentId: string) => Promise<string | null>;
export type ReversalOutcome = { applied: string[]; skipped: string[]; reason?: string };

const piId = (pi: StripeRefundLike["payment_intent"]) => (typeof pi === "string" ? pi : pi?.id ?? null);

function legs(debit: AccountSpec, credit: AccountSpec, cents: number): Posting[] {
  return [
    { accountId: debit.id, side: "debit", amount: cents },
    { accountId: credit.id, side: "credit", amount: cents },
  ];
}

async function apply(key: string, memo: string, debit: AccountSpec, credit: AccountSpec, cents: number, webhook: WebhookAck, out: ReversalOutcome) {
  const r = await applyFinancialEffect({ effectKey: key, memo, accounts: [debit, credit], postings: legs(debit, credit, cents), webhook });
  (r.applied ? out.applied : out.skipped).push(key);
}

export async function applyStripeRefund(refund: StripeRefundLike, resolveUser: ResolveUser, webhook: WebhookAck): Promise<ReversalOutcome> {
  const out: ReversalOutcome = { applied: [], skipped: [] };
  if (refund.status && refund.status !== "succeeded") return { ...out, reason: `refund_${refund.status}` };
  if (refund.currency?.toLowerCase() !== "usd") return { ...out, reason: "unsupported_currency" };
  const pi = piId(refund.payment_intent);
  const userId = pi ? await resolveUser(pi) : null;
  if (!userId) return { ...out, reason: "user_unresolved" };
  const cents = usdToCents(refund.amount / 100);
  if (cents <= 0) return { ...out, reason: "zero_amount" };
  const liability = userLiabilityAccount(userId);
  await apply(`stripe:refund:${refund.id}`, `Stripe refund ${refund.id}`, liability, ACCOUNTS.BANK_ESCROW, cents, webhook, out);
  return out;
}

export async function applyStripeDispute(
  dispute: StripeDisputeLike,
  phase: "opened" | "closed",
  resolveUser: ResolveUser,
  webhook: WebhookAck
): Promise<ReversalOutcome> {
  const out: ReversalOutcome = { applied: [], skipped: [] };
  if (dispute.currency?.toLowerCase() !== "usd") return { ...out, reason: "unsupported_currency" };
  const pi = piId(dispute.payment_intent);
  const userId = pi ? await resolveUser(pi) : null;
  if (!userId) return { ...out, reason: "user_unresolved" };
  const cents = usdToCents(dispute.amount / 100);
  const liability = userLiabilityAccount(userId);
  const hold = ACCOUNTS.CHARGEBACK_LIABILITY;

  // The hold is always the first step, and idempotent.
  await apply(`stripe:dispute:${dispute.id}:opened`, `Stripe dispute ${dispute.id} opened`, liability, hold, cents, webhook, out);
  if (phase === "opened") return out;

  if (dispute.status === "won") {
    await apply(`stripe:dispute:${dispute.id}:won`, `Stripe dispute ${dispute.id} won`, hold, liability, cents, webhook, out);
  } else if (dispute.status === "lost") {
    await apply(`stripe:dispute:${dispute.id}:lost`, `Stripe dispute ${dispute.id} lost`, hold, ACCOUNTS.BANK_ESCROW, cents, webhook, out);
  } else {
    out.reason = `closed_status_${dispute.status}`;
  }
  return out;
}
