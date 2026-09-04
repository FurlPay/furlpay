import { randomBytes } from "node:crypto";
import { kvGet, kvSet } from "../kv";
import { audit } from "../audit";

// ---------------------------------------------------------------------------
// Checkout sessions.
//
// WHAT THIS REPLACES. The previous route returned, for every request:
//
//     status: "complete",
//     transactionHash: "0x" + crypto.randomBytes(32).toString("hex"),
//
// A random 32-byte string presented as a blockchain transaction hash, and a
// completion status, for a payment that had not happened and could not have —
// nothing was persisted, no chain was contacted, and any non-empty
// X-Furlpay-Key was accepted. A merchant integrating @furlpay/elements would
// ship goods against it.
//
// So the rule this module exists to enforce:
//
//     A SESSION NEVER CARRIES SETTLEMENT EVIDENCE IT DID NOT OBSERVE.
//
// `transactionHash` is absent until a rail reports one. `status` starts at
// `requires_payment` and only advances on evidence. There is deliberately no
// code path that sets `completed` without a transaction reference, which is
// why `recordSettlement` is the only writer of that state.
//
// The lifecycle is rail-agnostic. Nothing here knows about x402, Arbitrum or
// Solana; a rail reports what it observed and this module records it. That is
// what lets a second rail arrive without reopening checkout.
// ---------------------------------------------------------------------------

export type CheckoutStatus =
  /** Created. Nobody has paid; nothing has been broadcast. */
  | "requires_payment"
  /** A payer has committed and a transaction reference exists. */
  | "submitted"
  /** Seen on-chain, but below the confirmation bar this amount requires. */
  | "confirming"
  /** Confirmed to the depth the settlement policy asked for. */
  | "confirmed"
  /** Irreversible by the chain's own finality rule. */
  | "finalized"
  /** Terminal success: finality reached AND the merchant was notified. */
  | "completed"
  /** The quote's window closed with no payment. */
  | "expired"
  /** Withdrawn by merchant or payer before payment. */
  | "cancelled"
  /** A rail reported definite failure. Distinct from `unknown`. */
  | "failed"
  /**
   * Real money arrived, but less than the price.
   *
   * Deliberately not `failed`: the funds exist and still belong to the payer,
   * so this needs a merchant decision (accept, request a top-up, or refund)
   * rather than an automatic verdict.
   */
  | "underpaid"
  /**
   * A transaction may exist and its outcome cannot be established.
   *
   * NOT a synonym for failed. A timeout is the absence of evidence, and a
   * checkout that resolves absence-of-evidence into failure invites a second
   * payment for the same order.
   */
  | "unknown";

/** Statuses from which no further transition is legal. */
const TERMINAL: readonly CheckoutStatus[] = ["completed", "expired", "cancelled", "failed"];

/**
 * Legal transitions.
 *
 * `unknown` is reachable from every in-flight state and can return to any of
 * them, because later evidence resolves it. It cannot reach `completed`
 * directly — resolving an unknown means establishing what actually happened
 * first.
 */
const TRANSITIONS: Readonly<Record<CheckoutStatus, readonly CheckoutStatus[]>> = {
  requires_payment: ["submitted", "expired", "cancelled"],
  submitted: ["confirming", "confirmed", "underpaid", "failed", "unknown"],
  confirming: ["confirmed", "underpaid", "failed", "unknown"],
  confirmed: ["finalized", "completed", "unknown"],
  finalized: ["completed", "unknown"],
  completed: [],
  expired: [],
  cancelled: [],
  failed: [],
  // A top-up or a merchant acceptance resolves it; refunding ends it.
  underpaid: ["confirmed", "cancelled", "failed"],
  unknown: ["submitted", "confirming", "confirmed", "finalized", "underpaid", "failed"],
};

export interface CheckoutSession {
  id: string;
  merchantKeyId: string;
  /** Integer atomic units as a decimal string. Never a float. */
  amountAtomic: string;
  decimals: number;
  currency: string;
  /** Display symbol. Identity is asset + network, never the symbol alone. */
  token: string;
  /** Canonical `chain:network`, once a rail is chosen. */
  network: string | null;
  payerWallet: string | null;
  status: CheckoutStatus;
  /**
   * OBSERVED settlement reference. Null until a rail reports one.
   *
   * Never generated locally. The absence of this field is the whole point of
   * the module.
   */
  transactionHash: string | null;
  /** Atomic units actually received. Null until a rail reports one. */
  amountReceivedAtomic: string | null;
  confirmations: number | null;
  requiredConfirmations: number | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  failureReason: string | null;
}

/** The shape returned over the wire. */
export interface CheckoutSessionPublic {
  id: string;
  status: CheckoutStatus;
  amount: string;
  currency: string;
  token: string;
  network: string | null;
  transactionHash: string | null;
  /** What actually arrived, so a merchant can see a shortfall. */
  amountReceived: string | null;
  confirmations: number | null;
  requiredConfirmations: number | null;
  expiresAt: string;
  createdAt: string;
  failureReason: string | null;
}

const KEY = (id: string) => `checkout:session:${id}`;

/** Sessions outlive their quote so a late payer gets `expired` rather than a
 *  404 that reads like "we lost your order". */
const RETENTION_SECONDS = 7 * 24 * 3600;
export const DEFAULT_TTL_SECONDS = 15 * 60;

export function toPublic(s: CheckoutSession): CheckoutSessionPublic {
  return {
    id: s.id,
    status: s.status,
    amount: formatAtomic(s.amountAtomic, s.decimals),
    currency: s.currency,
    token: s.token,
    network: s.network,
    transactionHash: s.transactionHash,
    amountReceived:
      s.amountReceivedAtomic === null ? null : formatAtomic(s.amountReceivedAtomic, s.decimals),
    confirmations: s.confirmations,
    requiredConfirmations: s.requiredConfirmations,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
    failureReason: s.failureReason,
  };
}

/** Atomic units to a display string, without floating point. */
export function formatAtomic(atomic: string, decimals: number): string {
  const neg = atomic.startsWith("-");
  const digits = (neg ? atomic.slice(1) : atomic).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = decimals > 0 ? "." + digits.slice(digits.length - decimals) : "";
  return `${neg ? "-" : ""}${whole}${frac}`;
}

/** Major-unit decimal string to integer atomic units. Rejects excess
 *  precision rather than truncating someone's money away. */
export function toAtomic(amount: string, decimals: number): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) throw new RangeError(`amount must be a non-negative decimal, got "${amount}"`);
  const frac = m[2] ?? "";
  if (frac.length > decimals) {
    throw new RangeError(`amount has ${frac.length} decimal places; this asset supports ${decimals}`);
  }
  return (BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0")).toString();
}

export interface CreateSessionInput {
  merchantKeyId: string;
  amountAtomic: string;
  decimals: number;
  currency: string;
  token: string;
  network?: string | null;
  payerWallet?: string | null;
  ttlSeconds?: number;
}

export async function createSession(input: CreateSessionInput): Promise<CheckoutSession> {
  const now = Date.now();
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const session: CheckoutSession = {
    id: "cs_" + randomBytes(16).toString("hex"),
    merchantKeyId: input.merchantKeyId,
    amountAtomic: input.amountAtomic,
    decimals: input.decimals,
    currency: input.currency,
    token: input.token,
    network: input.network ?? null,
    payerWallet: input.payerWallet ?? null,
    // ALWAYS this. There is no input that produces a session already paid.
    status: "requires_payment",
    transactionHash: null,
    amountReceivedAtomic: null,
    confirmations: null,
    requiredConfirmations: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl * 1000).toISOString(),
    failureReason: null,
  };
  await kvSet(KEY(session.id), session, RETENTION_SECONDS);
  audit("checkout.session_created", input.merchantKeyId, {
    sessionId: session.id,
    amountAtomic: input.amountAtomic,
    currency: input.currency,
  });
  return session;
}

/**
 * Read a session, expiring it lazily.
 *
 * Expiry is evaluated on read rather than by a sweeper, so it holds even if no
 * background job ever runs — the same reason API-key expiry is checked at
 * verification time.
 */
export async function getSession(id: string): Promise<CheckoutSession | null> {
  const s = await kvGet<CheckoutSession>(KEY(id));
  if (!s) return null;
  if (s.status === "requires_payment" && Date.parse(s.expiresAt) <= Date.now()) {
    return transition(s, "expired", { failureReason: "The payment window closed." });
  }
  return s;
}

export class CheckoutTransitionError extends Error {
  constructor(from: CheckoutStatus, to: CheckoutStatus) {
    super(
      `illegal checkout transition ${from} -> ${to}; legal moves are [${TRANSITIONS[from].join(", ") || "none, it is terminal"}]`
    );
    this.name = "CheckoutTransitionError";
  }
}

export function canTransition(from: CheckoutStatus, to: CheckoutStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: CheckoutStatus): boolean {
  return TERMINAL.includes(status);
}

interface TransitionPatch {
  transactionHash?: string;
  amountReceivedAtomic?: string;
  confirmations?: number;
  requiredConfirmations?: number;
  network?: string;
  payerWallet?: string;
  failureReason?: string;
}

/**
 * Advance a session, persisting the result.
 *
 * The transaction hash is WRITE-ONCE. Overwriting it would discard evidence of
 * a broadcast that may still land, which is exactly the evidence a retry needs
 * in order not to pay twice.
 */
export async function transition(
  session: CheckoutSession,
  to: CheckoutStatus,
  patch: TransitionPatch = {}
): Promise<CheckoutSession> {
  if (!canTransition(session.status, to)) {
    throw new CheckoutTransitionError(session.status, to);
  }
  if (
    patch.transactionHash &&
    session.transactionHash &&
    patch.transactionHash !== session.transactionHash
  ) {
    throw new Error(
      `refusing to overwrite transactionHash ${session.transactionHash}; a second reference is a second payment`
    );
  }
  const next: CheckoutSession = {
    ...session,
    status: to,
    updatedAt: new Date().toISOString(),
    ...(patch.transactionHash !== undefined ? { transactionHash: patch.transactionHash } : {}),
    ...(patch.amountReceivedAtomic !== undefined
      ? { amountReceivedAtomic: patch.amountReceivedAtomic }
      : {}),
    ...(patch.confirmations !== undefined ? { confirmations: patch.confirmations } : {}),
    ...(patch.requiredConfirmations !== undefined
      ? { requiredConfirmations: patch.requiredConfirmations }
      : {}),
    ...(patch.network !== undefined ? { network: patch.network } : {}),
    ...(patch.payerWallet !== undefined ? { payerWallet: patch.payerWallet } : {}),
    ...(patch.failureReason !== undefined ? { failureReason: patch.failureReason } : {}),
  };
  await kvSet(KEY(next.id), next, RETENTION_SECONDS);
  audit("checkout.status_changed", session.merchantKeyId, {
    sessionId: session.id,
    from: session.status,
    to,
    transactionHash: next.transactionHash,
  });
  return next;
}

/**
 * Record what a rail actually observed.
 *
 * THE ONLY WRITER OF SETTLEMENT EVIDENCE. A reference is required — there is
 * no argument list that advances a session past `submitted` without one, which
 * is what makes fabrication structurally impossible rather than merely
 * discouraged.
 */
export async function recordSettlement(
  session: CheckoutSession,
  observed: {
    transactionHash: string;
    network: string;
    /**
     * Integer atomic units ACTUALLY received, as reported by the rail.
     *
     * Required. Without it this function verified that *a* payment existed and
     * never that it was the right size — one atomic unit against a $500
     * session would have reached `confirmed`. Evidence of a transaction is not
     * evidence of payment.
     */
    amountAtomic: string;
    confirmations: number;
    requiredConfirmations: number;
    /** True only when the chain's own finality rule is satisfied. */
    finalized: boolean;
  }
): Promise<CheckoutSession> {
  if (!observed.transactionHash) {
    throw new Error("recordSettlement requires an observed transaction reference");
  }

  // The rail must say which network it saw. A session that was quoted on one
  // network and paid on another has not been paid — the merchant's funds are
  // somewhere they did not ask for them.
  if (session.network && session.network !== observed.network) {
    return transition(session.status === "requires_payment"
      ? await transition(session, "submitted", {
          transactionHash: observed.transactionHash,
          network: observed.network,
        })
      : session,
      "failed",
      {
        failureReason: `Paid on ${observed.network}, but this session was quoted on ${session.network}.`,
      }
    );
  }

  const received = BigInt(observed.amountAtomic);
  const owed = BigInt(session.amountAtomic);
  const confirmed = observed.confirmations >= observed.requiredConfirmations;

  const evidence = {
    transactionHash: observed.transactionHash,
    network: observed.network,
    amountReceivedAtomic: observed.amountAtomic,
    confirmations: observed.confirmations,
    requiredConfirmations: observed.requiredConfirmations,
  };

  // UNDERPAYMENT IS NOT PAYMENT. It gets its own state rather than `failed`,
  // because the money is real and still belongs to the payer — the merchant
  // has to decide whether to accept it, ask for a top-up, or refund. Calling
  // it `failed` would imply nothing arrived; calling it `confirmed` would ship
  // the goods for less than the price.
  //
  // No tolerance band is applied. Gateways commonly offer one, but a
  // tolerance is a merchant pricing decision and inventing a default here
  // would silently discount every order in the system.
  if (received < owed) {
    const submitted =
      session.status === "requires_payment"
        ? await transition(session, "submitted", {
            transactionHash: observed.transactionHash,
            network: observed.network,
          })
        : session;
    return transition(submitted, "underpaid", {
      ...evidence,
      failureReason: `Received ${formatAtomic(observed.amountAtomic, session.decimals)} against ${formatAtomic(session.amountAtomic, session.decimals)} owed.`,
    });
  }

  // Walk the states rather than jumping, so the audit trail shows the path the
  // payment actually took. Finality is reached THROUGH confirmation — a
  // payment cannot be irreversible without first having been included, and
  // letting the walk skip a step would put a state in the record that the
  // chain never actually passed through.
  let current = session;
  if (current.status === "requires_payment") {
    current = await transition(current, "submitted", {
      transactionHash: observed.transactionHash,
      network: observed.network,
    });
  }
  if (current.status === "submitted" && !confirmed) {
    return transition(current, "confirming", evidence);
  }
  if (current.status === "submitted" || current.status === "confirming") {
    if (!confirmed) return transition(current, "confirming", evidence);
    current = await transition(current, "confirmed", evidence);
  }
  if (observed.finalized && current.status === "confirmed") {
    return transition(current, "finalized", evidence);
  }
  return current;
}
