// ---------------------------------------------------------------------------
// In-flight action guard. React `busy` state disables buttons a render later —
// a fast double-tap can land two presses before the re-render. This module-
// level guard is synchronous, so the second tap is suppressed even in that
// window. UX layer only: the server's idempotency remains the real protection.
// ---------------------------------------------------------------------------

const inFlight = new Set<string>();

export type ExclusiveResult<T> = { ran: true; value: T } | { ran: false };

/**
 * Run `fn` unless another call with the same `key` is still in flight.
 * The duplicate call resolves `{ ran: false }` without executing anything.
 * The key is released in `finally`, so a failure never wedges the action.
 */
export async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<ExclusiveResult<T>> {
  if (inFlight.has(key)) return { ran: false };
  inFlight.add(key);
  try {
    return { ran: true, value: await fn() };
  } finally {
    inFlight.delete(key);
  }
}
