import {
  getSettlement,
  pendingExpired,
  recentConfirmedSettlements,
  recordSettlement,
  unresolvedSettlements,
  type SettlementRecord,
} from "@/lib/x402SettlementStore";
import { autoTrip, networkScope } from "@/lib/settlementSafety";
import { requiredConfirmations } from "@/lib/x402";

// ---------------------------------------------------------------------------
// Settlement reconciliation against the chain. Read-only toward the chain and
// NEVER compensating: an uncertain transfer is surfaced, not re-sent. Sending a
// second payment to "fix" one whose outcome is unknown is how a reconciler
// becomes the double-payment bug.
//
// One pass, idempotent, restart-safe — the checkpoint is the store's own
// per-network indexes (lib/x402SettlementStore.ts), which every status change
// already maintains, so a crashed pass simply re-runs over the same set.
//
//   pending, receipt confirmed at depth   → confirmed
//   pending, receipt reverted             → abandoned (reason: reverted) — needs a human
//   pending, not found, past timeout      → abandoned (reason: not_found)
//   pending, not found, within timeout    → unchanged (not proof of failure)
//   confirmed (last 24h), receipt missing → REORG: halt the network
//   confirmed (last 24h), now reverted    → REORG: halt the network
//   RPC error on any read                 → unchanged, counted, never assumed
// ---------------------------------------------------------------------------

export type ChainCheck = (
  tx: string,
  network: string,
) => Promise<{ found: boolean; confirmed: boolean; confirmations: number } | null>;

export interface ReconcileResult {
  network: string;
  checked: number;
  confirmed: string[];
  abandoned: string[];
  stillPending: string[];
  reorged: string[];
  errors: number;
  tripped: boolean;
}

const REORG_LOOKBACK_MS = 24 * 3600_000;

export async function reconcileNetwork(
  network: string,
  check: ChainCheck,
  now: number = Date.now(),
): Promise<ReconcileResult> {
  const out: ReconcileResult = {
    network, checked: 0, confirmed: [], abandoned: [], stillPending: [], reorged: [], errors: 0, tripped: false,
  };

  for (const tx of await unresolvedSettlements(network)) {
    const rec = await getSettlement(tx);
    if (!rec) continue; // record expired; the index entry is stale
    out.checked++;
    if (rec.status === "abandoned") {
      out.stillPending.push(tx); // terminal until a human resolves it
      continue;
    }
    let r: Awaited<ReturnType<ChainCheck>>;
    try {
      r = await check(tx, network);
    } catch {
      out.errors++;
      out.stillPending.push(tx);
      continue;
    }
    if (!r) {
      out.errors++;
      out.stillPending.push(tx);
      continue;
    }
    if (r.found && r.confirmed && r.confirmations >= requiredConfirmations(rec.amountAtomic)) {
      await recordSettlement({ ...rec, status: "confirmed" });
      out.confirmed.push(tx);
    } else if (r.found && !r.confirmed) {
      await recordSettlement({ ...rec, status: "abandoned", abandonedReason: "reverted on-chain" });
      out.abandoned.push(tx);
    } else if (!r.found && pendingExpired(rec, now)) {
      await recordSettlement({ ...rec, status: "abandoned", abandonedReason: "not found on-chain past the pending timeout" });
      out.abandoned.push(tx);
    } else {
      out.stillPending.push(tx);
    }
  }

  for (const tx of await recentConfirmedSettlements(network, now - REORG_LOOKBACK_MS)) {
    out.checked++;
    let r: Awaited<ReturnType<ChainCheck>>;
    try {
      r = await check(tx, network);
    } catch {
      out.errors++;
      continue;
    }
    if (!r) {
      out.errors++;
      continue;
    }
    if (!r.found || !r.confirmed) out.reorged.push(tx);
  }

  if (out.reorged.length) {
    // A settlement we reported final is no longer on the canonical chain. The
    // record stays "confirmed" — rewriting history would hide the incident —
    // and the network halts until a human reconciles each one.
    out.tripped = (await autoTrip({
      scope: networkScope(network),
      signal: "settlement_reorged",
      severity: "critical",
      evidence: { network, transactions: out.reorged.slice(0, 10), count: out.reorged.length },
      actor: "system:reconciler",
      to: "HALTED",
    })) === "tripped";
  }
  return out;
}

export type { SettlementRecord };
