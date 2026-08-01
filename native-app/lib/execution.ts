import { ApiError } from "@/lib/api";

// ---------------------------------------------------------------------------
// Vocabulary shared by every rail that moves money (swap, send).
//
// The stages are deliberately the ones that ACTUALLY exist on these rails: one
// authorization, one submission, one settlement. Neither /api/swaps nor
// /api/wallets/transfer streams intermediate on-chain events, so a finer-
// grained timeline would be an animation of something that is not happening.
// ---------------------------------------------------------------------------

export type ExecutionStage = "idle" | "authorizing" | "submitting" | "settled" | "failed";

/**
 * The message a user should read for a failure.
 *
 * Prefers the server's `detail` — it is written for a person — and falls back
 * to the error text. Never returns an empty string: a money screen showing a
 * blank error is indistinguishable from one that silently did nothing.
 */
export function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    const detail = (e.data as { detail?: string } | null)?.detail;
    return detail ?? e.message;
  }
  return (e as Error)?.message ?? "Something went wrong.";
}

/** Correlation id for a failed request, when the transport supplied one. */
export function correlationOf(e: unknown): string | null {
  return e instanceof ApiError ? (e.correlationId ?? null) : null;
}
