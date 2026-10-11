// The registered FurlPay analytics sink, reachable from sign-out without
// importing the platform wiring (AsyncStorage, expo-*), so lib/auth.ts stays
// importable in tests and on any platform without the sink.

interface ClearableSink {
  upload(): Promise<unknown>;
  clear(): Promise<void>;
}

let active: ClearableSink | null = null;

export function setActiveAnalyticsSink(sink: ClearableSink | null): void {
  active = sink;
}

/**
 * Sign-out hygiene for the analytics queue (audit 7 Oct 2026, P2-1): upload
 * what this account recorded while its token is still valid (best-effort),
 * then drop the rest so the next account never inherits it. Call BEFORE the
 * token is cleared.
 */
export async function flushAndClearAnalytics(): Promise<void> {
  if (!active) return;
  await active.upload().catch(() => undefined);
  await active.clear().catch(() => undefined);
}

/** Drop the queue without uploading (the token is already gone or invalid). */
export function clearAnalyticsQueue(): void {
  if (active) void active.clear().catch(() => undefined);
}
