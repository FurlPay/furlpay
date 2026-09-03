import { randomUUID } from "crypto";
import { getAccount, setSubscriptionTier } from "@/lib/store";
import type { Tier } from "@/lib/entitlements";

// ---------------------------------------------------------------------------
// Paid membership tiers and the cashback programme that rides on them.
//
// The subscription lifecycle follows the shape Tangem's TangemPay uses, because
// it gets the hard part right: an UPGRADE applies immediately (the customer
// paid for more, give it to them now), a DOWNGRADE is SCHEDULED to the billing
// boundary (they already paid for the period they are in — taking benefits away
// early is taking something they bought). A downgrade therefore lives as a
// `pendingPlan` + `pendingTransitionAt` on the still-active subscription, and
// can be cancelled right up to the boundary.
//
// A SYSTEM downgrade is the involuntary one — a failed renewal charge. It is
// modelled separately from a customer downgrade so support can tell "they chose
// to leave" apart from "their card bounced", which are very different
// conversations.
//
// MOCK/in-memory like the other service modules; the state machine and the
// accrual rules are the parts meant to survive the move to Postgres.
// ---------------------------------------------------------------------------

export type SubscriptionStatus =
  | "active" // on a plan, nothing scheduled
  | "downgrade_pending" // customer asked to move down at the boundary
  | "system_downgrade_pending" // renewal failed; drops at the boundary unless paid
  | "canceled"; // ran out and fell back to the free tier

export interface MembershipPlan {
  id: Tier;
  name: string;
  /** The free plan every account starts on. */
  isBasic: boolean;
  monthlyUsd: number;
  annualUsd: number;
  /** Base cashback rate on card spend, as a percentage. */
  cashbackRate: number;
  /** Monthly ceiling on cashback earnings, in USD. Unlimited when null. */
  cashbackCapUsd: number | null;
  benefits: string[];
}

export const MEMBERSHIP_PLANS: MembershipPlan[] = [
  {
    id: "Standard",
    name: "Standard",
    isBasic: true,
    monthlyUsd: 0,
    annualUsd: 0,
    cashbackRate: 0.5,
    cashbackCapUsd: 20,
    benefits: ["Virtual card", "Spot FX at interbank + 1%", "0.5% cashback"],
  },
  {
    id: "Pro",
    name: "Pro",
    isBasic: false,
    monthlyUsd: 9.99,
    annualUsd: 99.99,
    cashbackRate: 1.5,
    cashbackCapUsd: 100,
    benefits: ["Everything in Standard", "Physical metal card", "1.5% cashback", "Priority support"],
  },
  {
    id: "Ultra",
    name: "Ultra",
    isBasic: false,
    monthlyUsd: 29.99,
    annualUsd: 299.99,
    cashbackRate: 3,
    cashbackCapUsd: null,
    benefits: [
      "Everything in Pro",
      "3% uncapped cashback",
      "Airport lounge access",
      "Dedicated account manager",
    ],
  },
];

const PLAN_RANK: Record<Tier, number> = { Standard: 0, Pro: 1, Ultra: 2 };

export function planFor(id: Tier): MembershipPlan {
  const plan = MEMBERSHIP_PLANS.find((p) => p.id === id);
  if (!plan) throw new Error("Unknown plan");
  return plan;
}

export type BillingPeriod = "monthly" | "annual";

export interface Subscription {
  userId: string;
  planId: Tier;
  status: SubscriptionStatus;
  period: BillingPeriod;
  autoRenew: boolean;
  startedAt: string;
  /** Null on the free plan — nothing is ever charged. */
  nextBillingAt: string | null;
  pendingPlanId: Tier | null;
  pendingTransitionAt: string | null;
  /** Why the pending move exists — a customer choice or a failed charge. */
  pendingReason: "downgrade" | "system_downgrade" | null;
}

export interface SubscriptionEvent {
  id: string;
  userId: string;
  at: string;
  type: "activation" | "upgrade" | "downgrade_scheduled" | "downgrade_applied" | "transition_cancelled" | "renewal" | "system_downgrade_scheduled";
  fromPlanId: Tier;
  toPlanId: Tier;
  amountUsd: number;
}

// --- cashback ---------------------------------------------------------------

/** Fraud blocks earning but never hides what was already earned. */
export type CashbackProgramStatus = "enabled" | "deactivated" | "disabled";

export interface CashbackAccrual {
  id: string;
  userId: string;
  /** The card transaction this came from — one accrual per transaction, ever. */
  transactionId: string;
  merchant: string;
  /** Merchant category, which can multiply the base rate. */
  mcc: string;
  spendUsd: number;
  /** The rate IN EFFECT WHEN SPENT — never re-read from the current plan. */
  rate: number;
  amountUsd: number;
  /** YYYY-MM the accrual counts against, for the monthly cap. */
  period: string;
  accruedAt: string;
  claimedAt: string | null;
}

/**
 * Category multipliers on top of the plan's base rate. Travel and dining are
 * the categories a card programme competes on.
 */
export const MCC_MULTIPLIERS: Record<string, { label: string; multiplier: number }> = {
  "4511": { label: "Airlines", multiplier: 2 },
  "7011": { label: "Hotels", multiplier: 2 },
  "5812": { label: "Restaurants", multiplier: 1.5 },
  "5411": { label: "Groceries", multiplier: 1.25 },
  "5541": { label: "Fuel", multiplier: 1.25 },
  default: { label: "Everything else", multiplier: 1 },
};

interface MembershipState {
  subs: Map<string, Subscription>;
  events: SubscriptionEvent[];
  accruals: Map<string, CashbackAccrual>;
  programStatus: Map<string, CashbackProgramStatus>;
}

const globalForMembership = globalThis as unknown as { __membership?: MembershipState };
const state: MembershipState =
  globalForMembership.__membership ??
  (globalForMembership.__membership = {
    subs: new Map(),
    events: [],
    accruals: new Map(),
    programStatus: new Map(),
  });

export const MEMBERSHIP_LIMITS = {
  maxChargeUsd: 10_000,
  maxSpendPerAccrualUsd: 1_000_000,
} as const;

// --- subscription -----------------------------------------------------------

export function getSubscription(userId: string): Subscription {
  let sub = state.subs.get(userId);
  if (!sub) {
    sub = {
      userId,
      planId: "Standard",
      status: "active",
      period: "monthly",
      autoRenew: false,
      startedAt: new Date().toISOString(),
      nextBillingAt: null,
      pendingPlanId: null,
      pendingTransitionAt: null,
      pendingReason: null,
    };
    state.subs.set(userId, sub);
  }
  return sub;
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function record(e: Omit<SubscriptionEvent, "id" | "at">): void {
  state.events.push({ id: "evt_" + randomUUID(), at: new Date().toISOString(), ...e });
}

export interface ChangeResult {
  subscription: Subscription;
  /** What to charge now. Zero for a scheduled downgrade — they already paid. */
  chargeUsd: number;
  effect: "immediate" | "scheduled";
}

/**
 * Move to a different plan.
 *
 * Up is immediate and charged now; down is scheduled to the billing boundary
 * and charged nothing. Same-plan is refused rather than silently re-charging.
 */
export function changePlan(userId: string, to: Tier, period: BillingPeriod = "monthly"): ChangeResult {
  const sub = getSubscription(userId);
  const current = planFor(sub.planId);
  const target = planFor(to);

  if (to === sub.planId && period === sub.period) throw new Error("Already on this plan");

  const goingUp = PLAN_RANK[to] > PLAN_RANK[sub.planId];
  // A period switch on the same tier (monthly → annual) bills like an upgrade:
  // the customer is buying more up front and should get it now.
  const isPeriodUpgrade = to === sub.planId && period === "annual" && sub.period === "monthly";

  if (goingUp || isPeriodUpgrade) {
    const now = new Date();
    const chargeUsd = period === "annual" ? target.annualUsd : target.monthlyUsd;
    sub.planId = to;
    sub.period = period;
    sub.status = "active";
    sub.autoRenew = !target.isBasic;
    sub.startedAt = now.toISOString();
    sub.nextBillingAt = target.isBasic ? null : addMonths(now, period === "annual" ? 12 : 1).toISOString();
    // An upgrade supersedes any scheduled move — you are not simultaneously
    // going up and down.
    sub.pendingPlanId = null;
    sub.pendingTransitionAt = null;
    sub.pendingReason = null;

    setSubscriptionTier(userId, to);
    record({
      userId,
      type: current.isBasic ? "activation" : "upgrade",
      fromPlanId: current.id,
      toPlanId: to,
      amountUsd: chargeUsd,
    });
    return { subscription: sub, chargeUsd, effect: "immediate" };
  }

  // Downgrade. The benefits keep running until the boundary they already paid
  // for; only then does the plan actually change.
  const at = sub.nextBillingAt ?? addMonths(new Date(), 1).toISOString();
  sub.pendingPlanId = to;
  sub.pendingTransitionAt = at;
  sub.pendingReason = "downgrade";
  sub.status = "downgrade_pending";
  sub.autoRenew = false;
  record({ userId, type: "downgrade_scheduled", fromPlanId: sub.planId, toPlanId: to, amountUsd: 0 });
  return { subscription: sub, chargeUsd: 0, effect: "scheduled" };
}

/** Withdraw a scheduled move; the active plan simply carries on. */
export function cancelPendingTransition(userId: string): Subscription {
  const sub = getSubscription(userId);
  if (!sub.pendingPlanId) throw new Error("No pending transition");
  const to = sub.pendingPlanId;
  sub.pendingPlanId = null;
  sub.pendingTransitionAt = null;
  sub.pendingReason = null;
  sub.status = "active";
  sub.autoRenew = !planFor(sub.planId).isBasic;
  record({ userId, type: "transition_cancelled", fromPlanId: sub.planId, toPlanId: to, amountUsd: 0 });
  return sub;
}

/**
 * A renewal charge failed. Schedule the drop to the basic plan rather than
 * applying it now — the customer keeps what they paid for until the boundary,
 * and has until then to fix their funding.
 */
export function scheduleSystemDowngrade(userId: string): Subscription {
  const sub = getSubscription(userId);
  if (planFor(sub.planId).isBasic) throw new Error("Already on the basic plan");
  sub.pendingPlanId = "Standard";
  sub.pendingTransitionAt = sub.nextBillingAt ?? new Date().toISOString();
  sub.pendingReason = "system_downgrade";
  sub.status = "system_downgrade_pending";
  sub.autoRenew = false;
  record({ userId, type: "system_downgrade_scheduled", fromPlanId: sub.planId, toPlanId: "Standard", amountUsd: 0 });
  return sub;
}

/**
 * Apply anything whose boundary has passed. Called by the billing cron; safe to
 * run repeatedly because it only acts on a transition that is actually due.
 */
export function applyDueTransitions(now: Date = new Date()): Subscription[] {
  const applied: Subscription[] = [];
  for (const sub of state.subs.values()) {
    if (!sub.pendingPlanId || !sub.pendingTransitionAt) continue;
    if (Date.parse(sub.pendingTransitionAt) > now.getTime()) continue;

    const from = sub.planId;
    const to = sub.pendingPlanId;
    sub.planId = to;
    sub.status = planFor(to).isBasic ? "canceled" : "active";
    sub.period = "monthly";
    sub.autoRenew = false;
    sub.nextBillingAt = planFor(to).isBasic ? null : addMonths(now, 1).toISOString();
    sub.pendingPlanId = null;
    sub.pendingTransitionAt = null;
    sub.pendingReason = null;

    setSubscriptionTier(sub.userId, to);
    record({ userId: sub.userId, type: "downgrade_applied", fromPlanId: from, toPlanId: to, amountUsd: 0 });
    applied.push(sub);
  }
  return applied;
}

export function setAutoRenew(userId: string, on: boolean): Subscription {
  const sub = getSubscription(userId);
  if (planFor(sub.planId).isBasic) throw new Error("The basic plan does not renew");
  sub.autoRenew = on;
  // Turning renewal off is the soft form of a downgrade: schedule the drop so
  // the customer sees exactly when it happens, rather than being surprised.
  if (!on && !sub.pendingPlanId) {
    sub.pendingPlanId = "Standard";
    sub.pendingTransitionAt = sub.nextBillingAt;
    sub.pendingReason = "downgrade";
    sub.status = "downgrade_pending";
  } else if (on && sub.pendingReason === "downgrade") {
    sub.pendingPlanId = null;
    sub.pendingTransitionAt = null;
    sub.pendingReason = null;
    sub.status = "active";
  }
  return sub;
}

export function subscriptionHistory(userId: string): SubscriptionEvent[] {
  return state.events.filter((e) => e.userId === userId).sort((a, b) => b.at.localeCompare(a.at));
}

// --- cashback ---------------------------------------------------------------

export function cashbackProgramStatus(userId: string): CashbackProgramStatus {
  return state.programStatus.get(userId) ?? "enabled";
}

export function setCashbackProgramStatus(userId: string, status: CashbackProgramStatus): void {
  state.programStatus.set(userId, status);
}

function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function multiplierFor(mcc: string): number {
  return (MCC_MULTIPLIERS[mcc] ?? MCC_MULTIPLIERS.default).multiplier;
}

/** What is already accrued this month, for cap arithmetic. */
export function earnedInPeriod(userId: string, period: string): number {
  let total = 0;
  for (const a of state.accruals.values()) {
    if (a.userId === userId && a.period === period) total += a.amountUsd;
  }
  return round2(total);
}

export interface AccrualResult {
  accrual: CashbackAccrual | null;
  /** Set when nothing accrued, so the caller can say why. */
  skipped?: "program_disabled" | "cap_reached" | "already_accrued";
}

/**
 * Accrue cashback for one card transaction.
 *
 * Keyed on the transaction id, so replaying the same settlement can never pay
 * twice. The rate is snapshotted here and never recomputed: a later downgrade
 * must not retroactively shrink cashback the customer already earned.
 */
export function accrueCashback(
  userId: string,
  input: { transactionId: string; merchant: string; mcc: string; spendUsd: number; at?: Date },
): AccrualResult {
  const status = cashbackProgramStatus(userId);
  if (status !== "enabled") return { accrual: null, skipped: "program_disabled" };

  const key = `${userId}:${input.transactionId}`;
  if (state.accruals.has(key)) return { accrual: null, skipped: "already_accrued" };

  const at = input.at ?? new Date();
  const period = periodOf(at);
  const plan = planFor(getSubscription(userId).planId);
  const rate = round2(plan.cashbackRate * multiplierFor(input.mcc));

  let amountUsd = round2((input.spendUsd * rate) / 100);
  if (plan.cashbackCapUsd !== null) {
    const remaining = round2(plan.cashbackCapUsd - earnedInPeriod(userId, period));
    if (remaining <= 0) return { accrual: null, skipped: "cap_reached" };
    // Partial accrual up to the cap rather than dropping the whole thing —
    // the customer earned what fits.
    amountUsd = Math.min(amountUsd, remaining);
  }

  const accrual: CashbackAccrual = {
    id: "cb_" + randomUUID(),
    userId,
    transactionId: input.transactionId,
    merchant: input.merchant,
    mcc: input.mcc,
    spendUsd: input.spendUsd,
    rate,
    amountUsd,
    period,
    accruedAt: at.toISOString(),
    claimedAt: null,
  };
  state.accruals.set(key, accrual);
  return { accrual };
}

export function cashbackHistory(userId: string): CashbackAccrual[] {
  return [...state.accruals.values()]
    .filter((a) => a.userId === userId)
    .sort((a, b) => b.accruedAt.localeCompare(a.accruedAt));
}

export function cashbackSummary(userId: string) {
  const status = cashbackProgramStatus(userId);
  const plan = planFor(getSubscription(userId).planId);
  const period = periodOf(new Date());
  const all = cashbackHistory(userId);
  const unclaimed = all.filter((a) => !a.claimedAt);

  return {
    status,
    // A disabled programme hides the UI entirely; a deactivated one still shows
    // the customer what they earned before the block.
    rate: plan.cashbackRate,
    capUsd: plan.cashbackCapUsd,
    period,
    earnedThisPeriodUsd: earnedInPeriod(userId, period),
    capRemainingUsd:
      plan.cashbackCapUsd === null ? null : round2(Math.max(0, plan.cashbackCapUsd - earnedInPeriod(userId, period))),
    unclaimedUsd: round2(unclaimed.reduce((s, a) => s + a.amountUsd, 0)),
    lifetimeUsd: round2(all.reduce((s, a) => s + a.amountUsd, 0)),
    accrualCount: all.length,
  };
}

export interface ClaimResult {
  claimedUsd: number;
  accrualIds: string[];
}

/**
 * Sweep every unclaimed accrual into a single payout. Refused while the
 * programme is deactivated — that block exists precisely to stop a payout.
 */
export function claimCashback(userId: string): ClaimResult {
  const status = cashbackProgramStatus(userId);
  if (status !== "enabled") throw new Error("Cashback programme is not active");

  const unclaimed = cashbackHistory(userId).filter((a) => !a.claimedAt);
  if (unclaimed.length === 0) throw new Error("Nothing to claim");

  const now = new Date().toISOString();
  let total = 0;
  const ids: string[] = [];
  for (const a of unclaimed) {
    a.claimedAt = now;
    total += a.amountUsd;
    ids.push(a.id);
  }
  return { claimedUsd: round2(total), accrualIds: ids };
}

/** Credit a claim to the user's USDC balance. Caller owns the production gate. */
export function creditCashbackToBalance(userId: string, amountUsd: number): boolean {
  const account = getAccount(userId);
  if (!account) return false;
  const bal = account.tokenBalances.find((b) => b.token === "USDC");
  if (bal) {
    bal.amount = round2(bal.amount + amountUsd);
    bal.usdValue = round2(bal.usdValue + amountUsd);
    return true;
  }
  account.tokenBalances.push({ token: "USDC", chain: "arbitrum", amount: amountUsd, usdValue: amountUsd });
  return true;
}

/** Test seam — the in-memory maps are process-global otherwise. */
export function __resetMembershipForTests(): void {
  state.subs.clear();
  state.events.length = 0;
  state.accruals.clear();
  state.programStatus.clear();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
