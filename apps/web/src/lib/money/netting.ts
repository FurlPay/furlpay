// ---------------------------------------------------------------------------
// Multilateral netting engine (MNE).
//
// High-frequency agent micropayments and merchant checkouts create a dense web
// of small obligations between the same handful of parties. Settling each one
// on-chain pays gas per obligation. Netting collapses the web first: compute
// what each party owes NET, then move only that.
//
// The math is standard multilateral netting:
//
//     N_i = SUM_j D[j][i]  -  SUM_j D[i][j]
//
// i.e. everything owed TO i, minus everything i owes. N_i > 0 means i is a net
// creditor and should receive; N_i < 0 means i is a net debtor and must pay.
//
// The part that is easy to get wrong — and that the marketing description of
// this algorithm always skips — is that the net VECTOR is not yet a set of
// payments. You still have to decide who pays whom. This module does that with
// a greedy debtor/creditor match producing AT MOST N-1 transfers, which is the
// known lower bound for settling an arbitrary net vector.
//
// INTEGER ONLY. Every amount is minor units (cents, or token base units). A
// float here would leave dust that breaks the conservation invariant, and the
// invariant is the only thing standing between "netting" and "losing money".
//
// COST CLAIMS ARE COMPUTED, NOT ASSERTED. `NettingResult.reduction` reports the
// measured drop in transfer count for the batch actually netted. Nothing here
// claims a fixed "88-94%" — that number depends entirely on how dense the
// obligation graph is, and a sparse batch nets to almost no saving at all.
// ---------------------------------------------------------------------------

export interface Obligation {
  /** Party that owes. */
  from: string;
  /** Party that is owed. */
  to: string;
  /** Integer minor units, strictly positive. */
  amountMinor: number;
  /** Optional caller reference, carried through for audit. */
  ref?: string;
}

export interface NetPosition {
  party: string;
  /** Positive = net creditor (receives). Negative = net debtor (pays). */
  netMinor: number;
}

export interface SettlementTransfer {
  from: string;
  to: string;
  amountMinor: number;
}

export interface NettingResult {
  positions: NetPosition[];
  transfers: SettlementTransfer[];
  reduction: {
    /** Transfers required with no netting — one per obligation. */
    grossTransferCount: number;
    /** Transfers actually required after netting. */
    nettedTransferCount: number;
    /** Measured reduction, 0..1. 0 when netting saved nothing. */
    ratio: number;
    /** Total value of all obligations, before netting. */
    grossValueMinor: number;
    /** Total value actually moved. Always <= grossValueMinor. */
    nettedValueMinor: number;
  };
}

export class NettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NettingError";
  }
}

/**
 * Compute net positions for a batch of obligations.
 *
 * Self-obligations (from === to) are rejected rather than silently dropped:
 * they almost always indicate a bug upstream, and quietly ignoring them hides
 * it while producing a plausible-looking result.
 */
export function computeNetPositions(obligations: readonly Obligation[]): NetPosition[] {
  const net = new Map<string, number>();

  for (const o of obligations) {
    if (!Number.isSafeInteger(o.amountMinor) || o.amountMinor <= 0) {
      throw new NettingError(
        `Obligation ${o.from} -> ${o.to} has amountMinor ${o.amountMinor}; must be a positive integer of minor units`,
      );
    }
    if (o.from === o.to) {
      throw new NettingError(`Obligation from "${o.from}" to itself — upstream bug, refusing to net`);
    }
    net.set(o.from, (net.get(o.from) ?? 0) - o.amountMinor);
    net.set(o.to, (net.get(o.to) ?? 0) + o.amountMinor);
  }

  // Deterministic order. Map iteration order is insertion-based, which would
  // make the resulting transfer set depend on obligation ordering — and that
  // makes a settlement batch irreproducible when replayed from an audit log.
  return [...net.entries()]
    .map(([party, netMinor]) => ({ party, netMinor }))
    .sort((a, b) => (a.party < b.party ? -1 : a.party > b.party ? 1 : 0));
}

/**
 * Turn a net vector into concrete transfers.
 *
 * Greedy match: take the largest debtor and the largest creditor, move the
 * smaller of the two magnitudes, and repeat. Each step fully discharges at
 * least one party, so the loop runs at most N-1 times and emits at most N-1
 * transfers.
 *
 * Why largest-first rather than any order: it maximises the value discharged
 * per transfer, which keeps the count near the minimum for realistic batches.
 */
export function deriveTransfers(positions: readonly NetPosition[]): SettlementTransfer[] {
  const total = positions.reduce((sum, p) => sum + p.netMinor, 0);
  if (total !== 0) {
    // Conservation is the safety property of the whole engine. If it fails,
    // something has created or destroyed value and NOTHING may be settled.
    throw new NettingError(
      `Net positions sum to ${total}, not 0 — obligations do not conserve value; refusing to derive transfers`,
    );
  }

  const debtors = positions
    .filter((p) => p.netMinor < 0)
    .map((p) => ({ party: p.party, remaining: -p.netMinor }))
    .sort((a, b) => b.remaining - a.remaining || (a.party < b.party ? -1 : 1));
  const creditors = positions
    .filter((p) => p.netMinor > 0)
    .map((p) => ({ party: p.party, remaining: p.netMinor }))
    .sort((a, b) => b.remaining - a.remaining || (a.party < b.party ? -1 : 1));

  const transfers: SettlementTransfer[] = [];
  let di = 0;
  let ci = 0;

  while (di < debtors.length && ci < creditors.length) {
    const debtor = debtors[di];
    const creditor = creditors[ci];
    const amountMinor = Math.min(debtor.remaining, creditor.remaining);

    transfers.push({ from: debtor.party, to: creditor.party, amountMinor });

    debtor.remaining -= amountMinor;
    creditor.remaining -= amountMinor;
    if (debtor.remaining === 0) di += 1;
    if (creditor.remaining === 0) ci += 1;
  }

  return transfers;
}

/**
 * Net a batch end to end.
 *
 * Returns the positions, the transfers to execute, and the MEASURED reduction
 * for this specific batch. A caller reporting savings should quote
 * `result.reduction.ratio`, never a remembered headline number.
 */
export function netBatch(obligations: readonly Obligation[]): NettingResult {
  if (obligations.length === 0) {
    return {
      positions: [],
      transfers: [],
      reduction: {
        grossTransferCount: 0,
        nettedTransferCount: 0,
        ratio: 0,
        grossValueMinor: 0,
        nettedValueMinor: 0,
      },
    };
  }

  const positions = computeNetPositions(obligations);
  const transfers = deriveTransfers(positions);

  const grossTransferCount = obligations.length;
  const nettedTransferCount = transfers.length;
  const grossValueMinor = obligations.reduce((s, o) => s + o.amountMinor, 0);
  const nettedValueMinor = transfers.reduce((s, t) => s + t.amountMinor, 0);

  return {
    positions,
    transfers,
    reduction: {
      grossTransferCount,
      nettedTransferCount,
      ratio:
        grossTransferCount === 0
          ? 0
          : (grossTransferCount - nettedTransferCount) / grossTransferCount,
      grossValueMinor,
      nettedValueMinor,
    },
  };
}

/**
 * Independent post-condition check, for use before a batch is committed.
 *
 * Re-derives each party's position from the DERIVED TRANSFERS and compares it
 * against the position derived from the ORIGINAL OBLIGATIONS. The two are
 * computed by different code paths, so this catches a bug in `deriveTransfers`
 * that a self-consistent check would not. Cheap, and the last thing standing
 * between a netting bug and real money.
 */
export function verifySettlement(
  obligations: readonly Obligation[],
  transfers: readonly SettlementTransfer[],
): { ok: true } | { ok: false; discrepancies: Array<{ party: string; expected: number; actual: number }> } {
  const expected = new Map(computeNetPositions(obligations).map((p) => [p.party, p.netMinor]));

  const actual = new Map<string, number>();
  for (const t of transfers) {
    actual.set(t.from, (actual.get(t.from) ?? 0) - t.amountMinor);
    actual.set(t.to, (actual.get(t.to) ?? 0) + t.amountMinor);
  }

  const discrepancies: Array<{ party: string; expected: number; actual: number }> = [];
  for (const party of new Set([...expected.keys(), ...actual.keys()])) {
    const e = expected.get(party) ?? 0;
    const a = actual.get(party) ?? 0;
    if (e !== a) discrepancies.push({ party, expected: e, actual: a });
  }

  return discrepancies.length === 0 ? { ok: true } : { ok: false, discrepancies };
}
