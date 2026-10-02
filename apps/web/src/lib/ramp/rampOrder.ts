import { randomUUID } from "crypto";
import { kvDel, kvGet, kvSet, kvSetNx, kvZAdd, kvZRangeByScore, kvZRem } from "@/lib/kv";
import {
  assertTransition,
  isTerminal,
  type FlowKind,
  type TxReferences,
  type TxState,
} from "@/lib/money/lifecycle";

// ---------------------------------------------------------------------------
// Persistent ramp orders — the record a provider webhook advances.
//
// Before this, /api/onramp/session returned a checkout URL and kept nothing,
// so a verified Transak webhook had no order to move and could only be
// audited. Every ramp session that reaches a provider now creates one of these.
//
// STORAGE (Upstash via lib/kv.ts, the REST client the rest of the app uses):
//   ramp:order:{orderId}                          full RampOrder
//   ramp:provider:{providerId}:{providerOrderId}  orderId (webhook reverse lookup)
//   ramp:user:{userId}:orders                     zset of orderIds by createdAt
//   ramp:partner:{partnerId}:orders               zset of orderIds by createdAt
//   ramp:sweepable                                zset of orderIds by updatedAt, ONLY while in a
//                                                 state the stale sweep can resolve
//                                                 (PAYMENT_PENDING, CRYPTO_PENDING, PROVIDER_PENDING).
//                                                 Orders waiting on a person (MANUAL_REVIEW) are
//                                                 not in it, so they cannot starve the sweep.
// Active orders have no TTL. A terminal order is re-written with a 90-day TTL
// so finished records age out; an active one never silently disappears.
//
// TRANSITIONS go through lib/money/lifecycle.ts. An illegal move or one
// missing its evidence throws TransitionError and nothing is written: a
// provider saying "COMPLETED" cannot complete an order without the proof the
// flow requires.
//
// CONCURRENCY. Two webhooks for one order can arrive together. Updates take a
// short per-order lock (SET NX, 10 s) so a read-modify-write cannot lose a
// transition or its history entry.
// ---------------------------------------------------------------------------

export type RampProviderId = "furlgateway" | "furlbridge" | "furlpayout";
export type RampDirection = "onramp" | "offramp";
export type RampTrigger = "webhook" | "poll" | "user" | "system";

export interface RampStatusChange {
  from: TxState;
  to: TxState;
  at: string;
  trigger: RampTrigger;
  evidence?: string;
}

export interface RampOrder {
  orderId: string;
  providerOrderId?: string;
  providerId: RampProviderId;
  direction: RampDirection;
  /** Which transition table governs this order. */
  flowKind: FlowKind;
  /** True when the provider pushes status (webhooks). Clients poll only then. */
  statusFeed: boolean;

  userId?: string;
  partnerId?: string;
  beneficiaryId?: string;

  /**
   * Absent for a hosted SELL: the payout currency and amount are chosen on the
   * provider page and never reported to FurlPay. Recorded only when known.
   */
  fiatCurrency?: string;
  fiatAmountMinor?: number;
  cryptoAsset: string;
  cryptoAmount?: string;
  chain: string;
  /** On-ramp: the wallet the crypto must land in. Checked on-chain before CRYPTO_CONFIRMED. */
  destinationAddress?: string;

  status: TxState;
  providerStatus?: string;
  checkoutUrl?: string;
  depositAddress?: string;
  txHash?: string;
  /** Evidence collected so far (provider ref, chain tx hash, ...). */
  refs: TxReferences;

  createdAt: string;
  updatedAt: string;
  expiresAt?: string;

  statusHistory: RampStatusChange[];
}

export interface CreateRampOrderInput {
  providerId: RampProviderId;
  direction: RampDirection;
  flowKind: FlowKind;
  statusFeed: boolean;
  userId?: string;
  partnerId?: string;
  beneficiaryId?: string;
  /**
   * Absent for a hosted SELL: the payout currency and amount are chosen on the
   * provider page and never reported to FurlPay. Recorded only when known.
   */
  fiatCurrency?: string;
  fiatAmountMinor?: number;
  cryptoAsset: string;
  cryptoAmount?: string;
  chain: string;
  destinationAddress?: string;
  expiresAt?: string;
}

export interface StatusUpdate {
  to: TxState;
  trigger: RampTrigger;
  evidence?: string;
  /** Evidence to merge before the transition is checked. */
  refs?: Partial<TxReferences>;
  providerStatus?: string;
  txHash?: string;
  cryptoAmount?: string;
}

export interface PaginationOpts {
  limit?: number;
}

const TERMINAL_TTL_S = 90 * 24 * 3600;
const LOCK_TTL_S = 10;

const orderKey = (id: string) => `ramp:order:${id}`;
const providerKey = (p: string, ref: string) => `ramp:provider:${p}:${ref}`;
const userIndex = (u: string) => `ramp:user:${u}:orders`;
const partnerIndex = (p: string) => `ramp:partner:${p}:orders`;
const lockKey = (id: string) => `ramp:lock:${id}`;
export const SWEEP_INDEX = "ramp:sweepable";
const SWEEPABLE: readonly TxState[] = ["PAYMENT_PENDING", "CRYPTO_PENDING", "PROVIDER_PENDING"];

export class RampOrderError extends Error {
  constructor(
    readonly code: "not_found" | "locked" | "owner_required",
    message: string
  ) {
    super(message);
    this.name = "RampOrderError";
  }
}

async function save(order: RampOrder): Promise<void> {
  await kvSet(orderKey(order.orderId), order, isTerminal(order.status) ? TERMINAL_TTL_S : undefined);
  if (SWEEPABLE.includes(order.status)) await kvZAdd(SWEEP_INDEX, Date.parse(order.updatedAt), order.orderId);
  else await kvZRem(SWEEP_INDEX, [order.orderId]);
}

/** Sweepable orders not updated since `olderThanMs` (epoch ms), oldest first. */
export async function listIdleActiveOrders(olderThanMs: number, limit = 200): Promise<string[]> {
  return (await kvZRangeByScore(SWEEP_INDEX, "-inf", olderThanMs)).slice(0, limit);
}

export async function createRampOrder(input: CreateRampOrderInput): Promise<RampOrder> {
  // An order belongs to someone: a FurlPay user or a partner. Never neither.
  if (!input.userId && !input.partnerId) {
    throw new RampOrderError("owner_required", "A ramp order needs a userId or a partnerId.");
  }
  const now = new Date();
  const order: RampOrder = {
    ...input,
    orderId: randomUUID(),
    status: "CREATED",
    refs: {},
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    statusHistory: [],
  };
  await save(order);
  if (order.userId) await kvZAdd(userIndex(order.userId), now.getTime(), order.orderId);
  if (order.partnerId) await kvZAdd(partnerIndex(order.partnerId), now.getTime(), order.orderId);
  return order;
}

export async function getRampOrder(orderId: string): Promise<RampOrder | null> {
  return kvGet<RampOrder>(orderKey(orderId));
}

export async function getRampOrderByProviderRef(
  providerId: string,
  providerOrderId: string
): Promise<RampOrder | null> {
  const orderId = await kvGet<string>(providerKey(providerId, providerOrderId));
  return orderId ? getRampOrder(orderId) : null;
}

async function withLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await kvSetNx(lockKey(orderId), 1, LOCK_TTL_S)) {
      try {
        return await fn();
      } finally {
        await kvDel(lockKey(orderId)).catch(() => {});
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new RampOrderError("locked", `Ramp order ${orderId} is busy.`);
}

/**
 * Attach the provider's own order id and index it for webhook lookup. The
 * reverse key is written once: a second, different id for the same order is a
 * provider inconsistency and is refused rather than silently re-pointed.
 */
export async function setProviderOrderId(orderId: string, providerOrderId: string): Promise<RampOrder> {
  return withLock(orderId, async () => {
    const order = await getRampOrder(orderId);
    if (!order) throw new RampOrderError("not_found", `No ramp order ${orderId}.`);
    if (order.providerOrderId && order.providerOrderId !== providerOrderId) {
      throw new Error(`Ramp order ${orderId} already has provider id ${order.providerOrderId}.`);
    }
    const updated: RampOrder = {
      ...order,
      providerOrderId,
      refs: { ...order.refs, providerRef: providerOrderId },
      updatedAt: new Date().toISOString(),
    };
    await save(updated);
    await kvSet(providerKey(order.providerId, providerOrderId), orderId);
    return updated;
  });
}

/** Record checkout details returned by the provider (no state change). */
export async function attachCheckout(
  orderId: string,
  fields: Partial<Pick<RampOrder, "checkoutUrl" | "depositAddress" | "expiresAt">>
): Promise<RampOrder> {
  return withLock(orderId, async () => {
    const order = await getRampOrder(orderId);
    if (!order) throw new RampOrderError("not_found", `No ramp order ${orderId}.`);
    const updated: RampOrder = {
      ...order,
      ...(fields.checkoutUrl !== undefined && { checkoutUrl: fields.checkoutUrl }),
      ...(fields.depositAddress !== undefined && { depositAddress: fields.depositAddress }),
      ...(fields.expiresAt !== undefined && { expiresAt: fields.expiresAt }),
      updatedAt: new Date().toISOString(),
    };
    await save(updated);
    return updated;
  });
}

/**
 * Move an order to a new state. Validates the transition (and its evidence)
 * against the order's flow before anything is written; throws TransitionError
 * on an illegal move. A "transition" to the current state with no new evidence
 * is a no-op that returns the order unchanged (webhook redelivery).
 */
export async function updateRampOrderStatus(orderId: string, update: StatusUpdate): Promise<RampOrder> {
  return withLock(orderId, async () => {
    const order = await getRampOrder(orderId);
    if (!order) throw new RampOrderError("not_found", `No ramp order ${orderId}.`);

    const refs: TxReferences = { ...order.refs, ...stripEmpty(update.refs ?? {}) };
    const now = new Date().toISOString();

    if (update.to === order.status) {
      const updated: RampOrder = {
        ...order,
        refs,
        providerStatus: update.providerStatus ?? order.providerStatus,
        updatedAt: now,
      };
      await save(updated);
      return updated;
    }

    assertTransition(order.flowKind, order.status, update.to, refs);

    const updated: RampOrder = {
      ...order,
      status: update.to,
      refs,
      providerStatus: update.providerStatus ?? order.providerStatus,
      txHash: update.txHash ?? refs.chainTxHash ?? order.txHash,
      cryptoAmount: update.cryptoAmount ?? order.cryptoAmount,
      updatedAt: now,
      statusHistory: [
        ...order.statusHistory,
        { from: order.status, to: update.to, at: now, trigger: update.trigger, ...(update.evidence && { evidence: update.evidence }) },
      ],
    };
    await save(updated);
    return updated;
  });
}

/** Record a provider status that maps to no FurlPay transition. */
export async function recordProviderStatus(orderId: string, providerStatus: string): Promise<RampOrder> {
  const order = await getRampOrder(orderId);
  if (!order) throw new RampOrderError("not_found", `No ramp order ${orderId}.`);
  return updateRampOrderStatus(orderId, { to: order.status, trigger: "webhook", providerStatus });
}

function stripEmpty(refs: Partial<TxReferences>): Partial<TxReferences> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(refs)) if (typeof v === "string" && v.trim()) out[k] = v;
  return out as Partial<TxReferences>;
}

async function listIndex(key: string, opts: PaginationOpts): Promise<RampOrder[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const ids = (await kvZRangeByScore(key, "-inf", "+inf")).reverse().slice(0, limit);
  const orders = await Promise.all(ids.map((id) => getRampOrder(id)));
  // An index entry whose order aged out (90-day TTL) is skipped, not an error.
  return orders.filter((o): o is RampOrder => o !== null);
}

/** Newest first. */
export function listUserOrders(userId: string, opts: PaginationOpts = {}): Promise<RampOrder[]> {
  return listIndex(userIndex(userId), opts);
}

/** Newest first. */
export function listPartnerOrders(partnerId: string, opts: PaginationOpts = {}): Promise<RampOrder[]> {
  return listIndex(partnerIndex(partnerId), opts);
}

/**
 * The client-safe view. No checkout URL (single-use session token) once the
 * order has moved past PAYMENT_PENDING, and no internal refs beyond the
 * on-chain hash a user can look up themselves.
 */
export function publicRampOrder(o: RampOrder) {
  return {
    orderId: o.orderId,
    providerId: o.providerId,
    direction: o.direction,
    status: o.status,
    providerStatus: o.providerStatus ?? null,
    statusFeed: o.statusFeed,
    fiatCurrency: o.fiatCurrency ?? null,
    fiatAmountMinor: o.fiatAmountMinor ?? null,
    cryptoAsset: o.cryptoAsset,
    cryptoAmount: o.cryptoAmount ?? null,
    chain: o.chain,
    txHash: o.txHash ?? null,
    depositAddress: o.depositAddress ?? null,
    checkoutUrl: o.status === "PAYMENT_PENDING" || o.status === "CREATED" ? (o.checkoutUrl ?? null) : null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}
