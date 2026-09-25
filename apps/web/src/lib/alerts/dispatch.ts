import { sendPushToUser } from "@/lib/push";
import { log } from "@/lib/log";
import { alertMessage, evaluateTick, type TriggeredAlert } from "@/lib/alerts/userAlerts";

// ---------------------------------------------------------------------------
// Delivering a triggered price alert.
//
// SEPARATE FROM THE ENGINE ON PURPOSE. evaluateTick decides what fired and
// CLAIMS it (see userAlerts.ts); this module sends. Fusing them would mean a
// push provider outage could re-enter the matching logic, and the claim — which
// is what makes delivery exactly-once — would start depending on whether a
// third-party HTTP call succeeded.
//
// WHAT THIS IS NOT WIRED TO, stated plainly because the spec asked for it.
// Upstash QStash is NOT configured in this repository: there is no QSTASH_TOKEN,
// no @upstash/qstash dependency, and no existing publisher. Adding one would
// introduce a hard dependency on an unconfigured service, so dispatch goes
// through lib/push.ts, which is real and already delivers to web push and FCM.
//
// The seam for QStash is the `deliver` parameter. When a token exists, a
// publisher can be passed in without changing the engine, the route, or the
// claim semantics — the queue becomes a different `deliver`, not a rewrite.
//
// ORDERING NOTE. A claimed alert whose delivery fails is NOT re-armed. That is
// deliberate: re-arming on a send failure turns one undelivered notification
// into a loop that re-fires on every subsequent tick, and a user who missed one
// alert is better served than a user whose phone buzzes forever. The failure is
// logged with the alert id so it is diagnosable.
// ---------------------------------------------------------------------------

/** How a triggered alert reaches the user. Injected so this is testable. */
export type AlertDeliverer = (t: TriggeredAlert) => Promise<void>;

/** The default: the existing push fan-out (web push + FCM). */
export const pushDeliverer: AlertDeliverer = async (t) => {
  const { title, body } = alertMessage(t);
  await sendPushToUser(t.alert.userId, {
    title,
    body,
    // Deep link straight to the instrument, so the notification is actionable
    // rather than an invitation to go hunting for the symbol.
    url: `/markets/${encodeURIComponent(t.alert.symbol)}`,
    tag: `alert-${t.alert.id}`,
  });
};

export interface SweepResult {
  evaluated: number;
  triggered: number;
  delivered: number;
  failed: number;
}

/**
 * Evaluate a batch of symbol/price pairs and deliver whatever fired.
 *
 * Returns counts rather than the alerts themselves: a caller is an operator
 * endpoint, and the contents of other people's alerts are not its business.
 */
export async function sweepAlerts(
  ticks: { symbol: string; price: number }[],
  deliver: AlertDeliverer = pushDeliverer
): Promise<SweepResult> {
  const result: SweepResult = { evaluated: 0, triggered: 0, delivered: 0, failed: 0 };

  for (const { symbol, price } of ticks) {
    result.evaluated++;
    let claimed: TriggeredAlert[];
    try {
      claimed = await evaluateTick(symbol, price);
    } catch (e) {
      // A store failure must not abort the whole sweep — the remaining symbols
      // are independent, and one bad key should not silence every other alert.
      log.error("alert sweep: evaluation failed", { symbol, error: (e as Error).message });
      result.failed++;
      continue;
    }

    result.triggered += claimed.length;
    for (const t of claimed) {
      try {
        await deliver(t);
        result.delivered++;
      } catch (e) {
        // Claimed but undelivered. Not re-armed — see the header note.
        result.failed++;
        log.error("alert sweep: delivery failed", {
          alertId: t.alert.id,
          symbol: t.alert.symbol,
          error: (e as Error).message,
        });
      }
    }
  }

  return result;
}
