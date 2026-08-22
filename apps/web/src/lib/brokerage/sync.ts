// ---------------------------------------------------------------------------
// Order sync — reading provider state back on a schedule.
//
// THIS IS THE PRODUCTION PATH, and it is worth being clear about why the
// unglamorous option wins here. Alpaca publishes trade updates over Server-Sent
// Events: a connection held open for hours. Vercel functions have an execution
// ceiling measured in seconds, so nothing in this deployment can hold that
// socket. An SSE consumer would have to live outside the serverless runtime, on
// infrastructure that does not currently exist.
//
// Polling has none of that glamour and all of the reliability. It has no
// connection to drop, no reconnect-with-`since` cursor to get wrong, and it is
// self-healing: a missed update is simply picked up on the next pass. The
// latency cost is the poll interval, which for order state — as opposed to
// price ticks — is a few seconds nobody notices.
//
// When an SSE worker does exist, it feeds `ingestTradeEvent` and this keeps
// running underneath as the backstop. They are not alternatives: a stream is
// fast and can drop events, a poll is slow and cannot. Every serious order
// system runs both.
//
// WHAT THIS DOES NOT DO. It never creates an order record from provider state.
// An order at the provider that we have no record of is the most important
// finding reconciliation can produce, and manufacturing a local record for it
// would erase the discrepancy instead of reporting it — we could not say which
// user it belonged to, so we would be inventing an attribution.
// ---------------------------------------------------------------------------

import { log } from "@/lib/log";
import { applyProviderOrder, listOpenOrders, type OrderRecord } from "./orderStore";
import { isTerminal, type BrokerageProvider } from "./types";

export interface SyncResult {
  userId: string;
  provider: string;
  checked: number;
  advanced: number;
  settled: number;
  /** Orders the provider does not have. Never repaired here — reported. */
  orphaned: string[];
  /** Orders that could not be read this pass. Not a finding, just unfinished. */
  unreadable: string[];
  errors: string[];
  ranAt: string;
}

/**
 * Bring one user's open orders up to date.
 *
 * Only NON-terminal orders are polled: a filled order cannot change, so asking
 * about it forever is load with no information. `listOpenOrders` already
 * filters on that.
 */
export async function syncOpenOrders(
  userId: string,
  brokerage: BrokerageProvider,
  opts: { max?: number } = {}
): Promise<SyncResult> {
  const result: SyncResult = {
    userId,
    provider: brokerage.name,
    checked: 0,
    advanced: 0,
    settled: 0,
    orphaned: [],
    unreadable: [],
    errors: [],
    ranAt: new Date().toISOString(),
  };

  const open = (await listOpenOrders(userId)).slice(0, opts.max ?? 50);

  for (const record of open) {
    result.checked++;
    try {
      const remote = await brokerage.getOrder({
        clientOrderId: record.clientOrderId,
        providerOrderId: record.providerOrderId ?? undefined,
      });

      if (!remote) {
        // The provider has never heard of it. Only meaningful once we believe
        // it was submitted — a `created` record was never sent, so its absence
        // is correct.
        if (record.status !== "created") {
          result.orphaned.push(record.clientOrderId);
          log.error("order sync: provider has no record of a submitted order", {
            clientOrderId: record.clientOrderId,
            localStatus: record.status,
          });
        }
        continue;
      }

      if (remote.status === record.status && sameFill(remote.filledQty, record.filledQty)) {
        continue; // nothing new
      }

      const applied = await applyProviderOrder(record.clientOrderId, remote, "sync");
      if (applied.applied) {
        result.advanced++;
        if (isTerminal(applied.record.status)) result.settled++;
      } else if (applied.reason === "illegal_transition") {
        // Our record is AHEAD of what the provider just told us. Under polling
        // that is not reordering — it means the two disagree about something
        // real, which reconciliation must look at.
        result.errors.push(
          `${record.clientOrderId}: local ${record.status} cannot accept provider ${remote.status}`
        );
      } else {
        result.errors.push(`${record.clientOrderId}: ${applied.reason}`);
      }
    } catch (e) {
      // A read failure is not a finding. The order is unchanged and will be
      // polled again; recording it as orphaned would raise a false alarm every
      // time the provider hiccups.
      result.unreadable.push(record.clientOrderId);
      result.errors.push(`${record.clientOrderId}: ${e instanceof Error ? e.message : "read failed"}`);
    }
  }

  return result;
}

/** Fill quantities equal within float noise. See reconcile.ts for the epsilon
 *  rationale — fractional quantities cross the wire as decimal strings. */
function sameFill(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 1e-7;
}

/** Does this pass need a human? Orphaned orders always do. */
export function syncNeedsAttention(result: SyncResult): boolean {
  return result.orphaned.length > 0 || result.errors.length > 0;
}

/** One-line summary for a log or an ops row. */
export function summarizeSync(result: SyncResult): string {
  return (
    `${result.provider}: checked ${result.checked}, advanced ${result.advanced}, ` +
    `settled ${result.settled}` +
    (result.orphaned.length ? `, ORPHANED ${result.orphaned.length}` : "") +
    (result.unreadable.length ? `, unreadable ${result.unreadable.length}` : "")
  );
}

export type { OrderRecord };
