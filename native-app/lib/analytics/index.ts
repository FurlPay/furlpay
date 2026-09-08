import { addBreadcrumb, currentEnvironment, isObservabilityEnabled } from "@/lib/observability";
import { scrubValue } from "@/lib/observability/scrub";
import type { AnalyticsEvent, AnalyticsEventName, PropsFor } from "./events";

// ---------------------------------------------------------------------------
// Product analytics.
//
// SEPARATE FROM lib/observability BECAUSE THE TWO ANSWER DIFFERENT QUESTIONS
// and, more importantly, have different consent stories. Observability answers
// "did this build crash"; it is diagnostic, sampled, and short-retention.
// Analytics answers "did people finish the swap"; it is behavioural, retained
// for years, and in several of the jurisdictions FurlPay ships to it needs
// consent that crash reporting does not. Wiring product events through the
// error transport would make one opt-out impossible to express.
//
// PROVIDER-AGNOSTIC ON PURPOSE, and for the same reason the observability layer
// is: @react-native-firebase/analytics and the Amplitude SDK both have native
// layers that cannot be added or verified without an Android build, and this
// repo is developed on Windows without an attached device. So the app talks to
// THIS module; a sink adapter talks to the vendor. Adding Firebase later is
// registering a sink, not editing 60 screens.
//
// THE BUFFER IS NOT AN OPTIMISATION. Events fire during app launch, before any
// sink can have been registered (a sink needs config, config needs a network
// round trip). Dropping those would lose exactly the events that describe
// launch — cold start, first screen, auth. They are held in a bounded ring and
// flushed when a sink appears.
// ---------------------------------------------------------------------------

export interface AnalyticsSink {
  name: string;
  /** Props have ALREADY been scrubbed. */
  track(name: string, props: Record<string, unknown>, context: EventContext): void;
  identify(userId: string | null, traits: Record<string, unknown>): void;
  flush?(): Promise<void>;
}

export interface EventContext {
  timestamp: number;
  environment: string;
  sessionId: string;
  userId: string | null;
}

/**
 * Ring capacity. 200 events is a generous launch sequence and about 40KB;
 * unbounded would let an offline session grow until the app is killed, which
 * turns an analytics outage into a crash.
 */
const BUFFER_LIMIT = 200;

const sinks: AnalyticsSink[] = [];
const buffer: Array<{ name: string; props: Record<string, unknown>; context: EventContext }> = [];

let enabled = true;
let currentUserId: string | null = null;
// Not a security value — it only groups one run's events. `Date.now()` plus a
// counter is enough and avoids pulling expo-crypto into module init, which runs
// before the JS engine has finished starting on a cold launch.
const sessionId = `s_${Date.now().toString(36)}_${Math.floor(Date.now() % 1e6).toString(36)}`;

function context(): EventContext {
  return { timestamp: Date.now(), environment: currentEnvironment(), sessionId, userId: currentUserId };
}

export function registerSink(sink: AnalyticsSink): void {
  if (sinks.some((s) => s.name === sink.name)) return;
  sinks.push(sink);
  // Drain the launch backlog into the sink that just arrived.
  for (const ev of buffer) sink.track(ev.name, ev.props, ev.context);
  if (sinks.length === 1) buffer.length = 0;
}

/**
 * Consent / opt-out.
 *
 * Turning analytics OFF also clears the buffer. Keeping it would mean a user
 * who opts out still has their pre-opt-out launch events sent the moment a sink
 * registers, which is precisely the behaviour an opt-out is supposed to stop.
 */
export function setAnalyticsEnabled(on: boolean): void {
  enabled = on;
  if (!on) buffer.length = 0;
}

export function isAnalyticsEnabled(): boolean {
  return enabled && isObservabilityEnabled();
}

export function identify(userId: string | null, traits: Record<string, unknown> = {}): void {
  currentUserId = userId;
  if (!isAnalyticsEnabled()) return;
  const safe = (scrubValue(traits) ?? {}) as Record<string, unknown>;
  for (const s of sinks) s.identify(userId, safe);
}

/**
 * Record an event.
 *
 * The signature is the type-safety boundary: `name` must be a catalogue entry
 * and `props` must match that entry exactly. Adding a property to a call site
 * without adding it to lib/analytics/events.ts does not compile, which is the
 * only reliable way to keep an analytics schema honest over years.
 *
 * NEVER THROWS. An analytics failure must not take down the screen that emitted
 * it — a swap does not fail because a metrics sink is down.
 */
export function track<N extends AnalyticsEventName>(name: N, props: PropsFor<N>): void {
  if (!isAnalyticsEnabled()) return;
  try {
    // Backstop, not the primary control: the catalogue is what keeps sensitive
    // fields from existing. This catches the case where a legitimate property
    // (a dapp host, a failure `reason` copied from a server message) happens to
    // carry something that matches a denied shape.
    const safe = (scrubValue(props as Record<string, unknown>) ?? {}) as Record<string, unknown>;
    const ctx = context();

    if (sinks.length === 0) {
      if (buffer.length >= BUFFER_LIMIT) buffer.shift();
      buffer.push({ name, props: safe, context: ctx });
      return;
    }
    for (const s of sinks) s.track(name, safe, ctx);
  } catch {
    // Deliberately silent. Reporting an analytics failure through the error
    // transport risks a loop when the two share a broken dependency, and there
    // is no user-visible consequence to lose.
  }
}

/**
 * Record an event AND leave a breadcrumb.
 *
 * For the handful of events that are also diagnostically useful when a crash
 * happens moments later — a swap submission, a WalletConnect approval. Not the
 * default, because breadcrumb budgets are small and filling them with product
 * telemetry crowds out the HTTP trail that actually explains a crash.
 */
export function trackAndTrace<N extends AnalyticsEventName>(
  name: N,
  props: PropsFor<N>,
  category: "money" | "auth" | "ui" = "money",
): void {
  track(name, props);
  addBreadcrumb(category, name, props as Record<string, unknown>);
}

/** Best-effort flush. Awaited on backgrounding, never on a money path. */
export async function flushAnalytics(): Promise<void> {
  await Promise.allSettled(sinks.map((s) => s.flush?.() ?? Promise.resolve()));
}

/** Test seams. */
export function __sinksForTest(): AnalyticsSink[] {
  return sinks;
}

export function __resetAnalyticsForTest(): void {
  sinks.length = 0;
  buffer.length = 0;
  enabled = true;
  currentUserId = null;
}

export function __bufferForTest(): ReadonlyArray<{ name: string; props: Record<string, unknown> }> {
  return buffer;
}

export type { AnalyticsEvent, AnalyticsEventName, PropsFor };
export { bucketUsd } from "./events";
export type { AmountBucket, Outcome } from "./events";
