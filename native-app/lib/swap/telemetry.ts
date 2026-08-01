// ---------------------------------------------------------------------------
// Structured events for a swap, so a support ticket can be answered.
//
// The question this exists to answer is always the same: "my swap didn't
// arrive, what happened?" Answering it needs the route id, both transaction
// hashes, which bridge ran it, where it stopped and how long each phase took —
// and none of that is recoverable after the fact from a message that said
// "The swap didn't go through."
//
// WHAT IS DELIBERATELY NOT HERE. No mnemonic, no private key, no signed
// payload, no raw calldata. The wallet ADDRESS is public by definition (it is
// on-chain the moment it is used) but is still truncated, because a full log
// line pairing an address to a user id turns operational logs into a
// deanonymisation surface for anyone who can read them.
//
// Sinks are injected. This module decides WHAT is worth recording; where it
// goes (console in dev, Sentry/Crashlytics in release) is a wiring decision,
// and hardcoding a vendor here would make the events untestable.
// ---------------------------------------------------------------------------

export type SwapEventName =
  | "swap.quote"
  | "swap.approval"
  | "swap.broadcast"
  | "swap.confirmed"
  | "swap.bridge"
  | "swap.failed";

export interface SwapEvent {
  name: SwapEventName;
  /** Li.Fi's route id — the single most useful field in a support ticket. */
  routeId?: string | null;
  fromChain?: string;
  toChain?: string;
  fromToken?: string;
  toToken?: string;
  /** Bridge/DEX that ran it, as Li.Fi named it. */
  tool?: string | null;
  txHash?: string | null;
  approvalTxHash?: string | null;
  /** Phase the flow reached. On a failure, where it stopped. */
  step?: string;
  /** Machine-readable failure class, not the user-facing sentence. */
  reason?: string;
  /** Milliseconds since the flow started. */
  elapsedMs?: number;
  bridgeStatus?: string | null;
  bridgeSubstatus?: string | null;
}

export type SwapEventSink = (event: SwapEvent) => void;

const sinks: SwapEventSink[] = [];

/** Registers a sink (Sentry breadcrumb, Crashlytics log, a test spy). */
export function addSwapEventSink(sink: SwapEventSink): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.indexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}

/** Test/teardown helper. */
export function clearSwapEventSinks(): void {
  sinks.length = 0;
}

/**
 * Emits an event. Never throws.
 *
 * A telemetry failure must not be able to fail a swap — the user's money is
 * not contingent on our logging working, and an exception thrown from a sink
 * mid-flow would do exactly that.
 */
export function recordSwapEvent(event: SwapEvent): void {
  const safe = redact(event);
  for (const sink of sinks) {
    try {
      sink(safe);
    } catch {
      /* a broken sink is not a broken swap */
    }
  }
}

/** Truncates anything address- or hash-shaped. */
function redact(event: SwapEvent): SwapEvent {
  return {
    ...event,
    txHash: shorten(event.txHash),
    approvalTxHash: shorten(event.approvalTxHash),
  };
}

function shorten(value: string | null | undefined): string | null | undefined {
  if (!value || value.length <= 14) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

/** Wall-clock timer for phase durations. */
export function startSwapTimer(): () => number {
  const started = Date.now();
  return () => Date.now() - started;
}
