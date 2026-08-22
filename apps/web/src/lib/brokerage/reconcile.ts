// ---------------------------------------------------------------------------
// Reconciliation: our record versus the broker's.
//
// This is the control that catches everything the happy path misses. Orders
// fill after the request that created them has returned; webhooks are dropped;
// a lambda dies between the provider accepting an order and our ledger writing
// it down. None of those produce an error anyone sees — they produce a quiet
// divergence between what we believe and what is true, and the only way to find
// one is to compare the two sides on a schedule.
//
// THE PROVIDER IS AUTHORITATIVE FOR EXECUTION. It knows what filled and at what
// price; we do not. So a mismatch is always reported as "our record is wrong",
// never resolved by assuming the provider is.
//
// WHAT THIS MODULE DOES NOT DO: fix anything. It detects and classifies, and
// nothing more. Auto-correcting a financial discrepancy is how a detection bug
// becomes a money bug — a comparator with an off-by-one would happily "repair"
// a correct ledger. Remediation is a human decision with an audit trail behind
// it, so the output here is a finding, not a mutation.
// ---------------------------------------------------------------------------

import { isTerminal, type BrokerageOrder, type BrokerageProvider, type OrderStatus } from "./types";
import { listUserOrders, type OrderRecord } from "./orderStore";

export type ReconcileStatus =
  | "MATCHED"
  | "DATABASE_AHEAD" // we have an order the provider does not
  | "PROVIDER_AHEAD" // the provider has an order we do not
  | "STATUS_MISMATCH"
  | "QUANTITY_MISMATCH"
  | "PRICE_MISMATCH"
  | "UNKNOWN"; // could not be compared — never treated as matched

/** How severely a finding needs to be acted on. */
export type Severity = "ok" | "info" | "warning" | "critical";

export interface OrderFinding {
  clientOrderId: string;
  providerOrderId: string | null;
  symbol: string;
  status: ReconcileStatus;
  severity: Severity;
  detail: string;
  local: { status: OrderStatus; filledQty: number | null; filledAvgPrice: number | null } | null;
  remote: { status: OrderStatus; filledQty: number | null; filledAvgPrice: number | null } | null;
}

export interface PositionFinding {
  symbol: string;
  status: "MATCHED" | "QUANTITY_MISMATCH" | "DATABASE_AHEAD" | "PROVIDER_AHEAD";
  severity: Severity;
  localQty: number;
  remoteQty: number;
  difference: number;
}

export interface ReconcileReport {
  userId: string;
  provider: string;
  providerIsLive: boolean;
  ranAt: string;
  orders: OrderFinding[];
  positions: PositionFinding[];
  summary: {
    ordersChecked: number;
    ordersMatched: number;
    positionsChecked: number;
    positionsMatched: number;
    critical: number;
    warnings: number;
  };
  /** Set when the run itself could not complete. A report with this populated
   *  proves NOTHING about correctness and must never be read as a pass. */
  incomplete: string | null;
}

/**
 * Tolerance for a fractional-share quantity comparison.
 *
 * Not a fudge factor for real differences: fractional quantities cross the wire
 * as decimal strings and round-trip through IEEE-754 doubles, so 0.3333333333
 * and 0.33333333330000001 are the same fill. A tenth of a millionth of a share
 * is far below any economically meaningful amount and far above float noise.
 */
const QTY_EPSILON = 1e-7;

/** Price tolerance, in dollars. Half a cent — below the minimum tick, so a
 *  real price difference cannot hide underneath it. */
const PRICE_EPSILON = 0.005;

function closeEnough(a: number, b: number, epsilon: number): boolean {
  return Math.abs(a - b) <= epsilon;
}

/**
 * Compare one local record against its provider counterpart.
 *
 * `remote === null` means the provider does not have it — which is only a
 * finding when we believe it was submitted. An order still in `created` was
 * never sent, so its absence is correct.
 */
export function compareOrder(local: OrderRecord, remote: BrokerageOrder | null): OrderFinding {
  const base = {
    clientOrderId: local.clientOrderId,
    providerOrderId: local.providerOrderId,
    symbol: local.symbol,
    local: { status: local.status, filledQty: local.filledQty, filledAvgPrice: local.filledAvgPrice },
    remote: remote
      ? { status: remote.status, filledQty: remote.filledQty, filledAvgPrice: remote.filledAvgPrice }
      : null,
  };

  if (!remote) {
    if (local.status === "created") {
      return { ...base, status: "MATCHED", severity: "ok", detail: "Never submitted; correctly absent at the provider." };
    }
    return {
      ...base,
      status: "DATABASE_AHEAD",
      severity: "critical",
      detail:
        `We recorded this order as ${local.status} but the provider has no record of it. ` +
        "Either the submission never landed, or it was placed on a different account.",
    };
  }

  if (local.status !== remote.status) {
    // A local record BEHIND the provider is the ordinary case — a fill arrived
    // after our last update. A local record AHEAD is not ordinary: we believe
    // something the provider does not.
    const localTerminal = isTerminal(local.status);
    const remoteTerminal = isTerminal(remote.status);
    return {
      ...base,
      status: "STATUS_MISMATCH",
      severity: localTerminal && !remoteTerminal ? "critical" : "warning",
      detail:
        localTerminal && !remoteTerminal
          ? `We treat this order as finished (${local.status}) but the provider still has it working (${remote.status}). It can still fill.`
          : `Local status ${local.status} is behind the provider's ${remote.status}.`,
    };
  }

  // Quantity. A fill we have not recorded means a position we do not know we
  // hold; a fill we recorded that the provider did not means an invented one.
  const lq = local.filledQty;
  const rq = remote.filledQty;
  if (lq != null && rq != null && !closeEnough(lq, rq, QTY_EPSILON)) {
    return {
      ...base,
      status: "QUANTITY_MISMATCH",
      severity: "critical",
      detail: `Filled quantity differs: we have ${lq}, the provider has ${rq}.`,
    };
  }
  if (lq == null && rq != null && rq > 0) {
    return {
      ...base,
      status: "PROVIDER_AHEAD",
      severity: "critical",
      detail: `The provider reports ${rq} filled; we have recorded no fill. The position is unbooked.`,
    };
  }
  if (lq != null && lq > 0 && rq == null) {
    return {
      ...base,
      status: "QUANTITY_MISMATCH",
      severity: "critical",
      detail: `We recorded ${lq} filled but the provider reports no fill quantity.`,
    };
  }

  const lp = local.filledAvgPrice;
  const rp = remote.filledAvgPrice;
  if (lp != null && rp != null && !closeEnough(lp, rp, PRICE_EPSILON)) {
    return {
      ...base,
      status: "PRICE_MISMATCH",
      // The position size is right, so this is a cost-basis error rather than a
      // phantom holding — wrong on a tax form, not wrong about ownership.
      severity: "warning",
      detail: `Fill price differs: we have ${lp}, the provider has ${rp}. Cost basis is affected.`,
    };
  }

  return { ...base, status: "MATCHED", severity: "ok", detail: "Order matches the provider." };
}

/** Compare local positions against the provider's. */
export function comparePositions(
  local: { symbol: string; shares: number }[],
  remote: { symbol: string; qty: number }[]
): PositionFinding[] {
  const localBySymbol = new Map(local.map((h) => [h.symbol.toUpperCase(), h.shares]));
  const remoteBySymbol = new Map(remote.map((p) => [p.symbol.toUpperCase(), p.qty]));
  const symbols = new Set([...localBySymbol.keys(), ...remoteBySymbol.keys()]);

  const findings: PositionFinding[] = [];
  for (const symbol of symbols) {
    const localQty = localBySymbol.get(symbol) ?? 0;
    const remoteQty = remoteBySymbol.get(symbol) ?? 0;
    const difference = localQty - remoteQty;

    if (closeEnough(localQty, remoteQty, QTY_EPSILON)) {
      findings.push({ symbol, status: "MATCHED", severity: "ok", localQty, remoteQty, difference: 0 });
      continue;
    }
    findings.push({
      symbol,
      status: remoteQty === 0 ? "DATABASE_AHEAD" : localQty === 0 ? "PROVIDER_AHEAD" : "QUANTITY_MISMATCH",
      // Every position difference is critical. A position is what someone owns;
      // there is no size of ownership discrepancy that is merely informational.
      severity: "critical",
      localQty,
      remoteQty,
      difference,
    });
  }
  return findings.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

/**
 * Reconcile one user against the brokerage.
 *
 * A provider read that fails sets `incomplete` and returns whatever was
 * gathered. It does NOT return a clean report — a reconciliation that could not
 * run is not a reconciliation that passed, and reporting zero findings for an
 * unreachable provider is the most dangerous possible output.
 */
export async function reconcileUser(
  userId: string,
  localPositions: { symbol: string; shares: number }[],
  brokerage: BrokerageProvider,
  opts: { orderLimit?: number } = {}
): Promise<ReconcileReport> {
  const ranAt = new Date().toISOString();
  const report: ReconcileReport = {
    userId,
    provider: brokerage.name,
    providerIsLive: brokerage.isLive,
    ranAt,
    orders: [],
    positions: [],
    summary: {
      ordersChecked: 0,
      ordersMatched: 0,
      positionsChecked: 0,
      positionsMatched: 0,
      critical: 0,
      warnings: 0,
    },
    incomplete: null,
  };

  const localOrders = await listUserOrders(userId, opts.orderLimit ?? 100);

  // Orders: fetch each by client order id. One request per order rather than a
  // bulk listing, because a bulk listing paginates and a missing page would
  // look like a set of missing orders — the exact false positive that would
  // train an operator to ignore this report.
  for (const local of localOrders) {
    try {
      const remote = await brokerage.getOrder({
        clientOrderId: local.clientOrderId,
        providerOrderId: local.providerOrderId ?? undefined,
      });
      report.orders.push(compareOrder(local, remote));
    } catch (e) {
      report.orders.push({
        clientOrderId: local.clientOrderId,
        providerOrderId: local.providerOrderId,
        symbol: local.symbol,
        status: "UNKNOWN",
        severity: "warning",
        detail: `Could not read this order from the provider: ${e instanceof Error ? e.message : "error"}`,
        local: { status: local.status, filledQty: local.filledQty, filledAvgPrice: local.filledAvgPrice },
        remote: null,
      });
    }
  }

  try {
    const remotePositions = await brokerage.getPositions();
    report.positions = comparePositions(localPositions, remotePositions);
  } catch (e) {
    report.incomplete = `Positions could not be read from the provider: ${e instanceof Error ? e.message : "error"}`;
  }

  report.summary = {
    ordersChecked: report.orders.length,
    ordersMatched: report.orders.filter((o) => o.status === "MATCHED").length,
    positionsChecked: report.positions.length,
    positionsMatched: report.positions.filter((p) => p.status === "MATCHED").length,
    critical: [...report.orders, ...report.positions].filter((f) => f.severity === "critical").length,
    warnings: [...report.orders, ...report.positions].filter((f) => f.severity === "warning").length,
  };

  return report;
}

/** Does this report demand a human? True on any critical finding, and on any
 *  run that could not complete. */
export function needsAttention(report: ReconcileReport): boolean {
  return report.summary.critical > 0 || report.incomplete !== null;
}
