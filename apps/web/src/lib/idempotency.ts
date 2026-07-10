import { NextResponse } from "next/server";
import { kvGet, kvSet, kvSetNx, kvDel } from "./kv";

// ---------------------------------------------------------------------------
// Generic idempotency engine (Stripe / Circle pattern; IETF
// draft-ietf-httpapi-idempotency-key-header). A mutating route wrapped in
// withIdempotency() dedupes retries carrying the same `Idempotency-Key`:
//
//   - first request with a key    → runs the handler, caches the response
//   - retry with the same key      → returns the cached response verbatim
//     (header `Idempotent-Replayed: true`), never re-executing side effects
//   - concurrent request, same key → 409 while the first is in flight
//
// The claim is atomic across serverless instances (Redis SET NX via lib/kv),
// so two lambdas racing the same key can't both execute. Money routes already
// have nonce/lock-level dedup; this generalizes it to any route and makes
// client retries (timeouts, network blips) safe. Keys should be UUIDs.
//
// Only JSON responses are cached; a non-JSON or streamed response runs the
// handler and is returned uncached (the claim is released so a retry re-runs).
// ---------------------------------------------------------------------------

const TTL_SECONDS = 24 * 3600; // Stripe caches idempotent results for 24h
const KEY_MAX = 255;

interface IdempotencyRecord {
  status: "processing" | "completed";
  response?: { status: number; body: unknown };
}

const cacheKeyFor = (scope: string, key: string) => `idem:${scope}:${key}`;

/**
 * Run `handler` at most once per (scope, key). Pass the `Idempotency-Key`
 * header value; when absent, the handler runs normally (no dedup). `scope`
 * namespaces keys per route so the same client key can't collide across
 * endpoints (e.g. "wallets.transfer").
 */
export async function withIdempotency(
  key: string | null | undefined,
  scope: string,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  if (!key) return handler();
  if (key.length > KEY_MAX) {
    return NextResponse.json(
      { error: "invalid_idempotency_key", message: `Idempotency-Key exceeds ${KEY_MAX} chars` },
      { status: 400 }
    );
  }
  const cacheKey = cacheKeyFor(scope, key);

  // Fast path: a completed result is replayed without touching the handler.
  const existing = await kvGet<IdempotencyRecord>(cacheKey).catch(() => null);
  if (existing?.status === "completed" && existing.response) {
    return NextResponse.json(existing.response.body, {
      status: existing.response.status,
      headers: { "Idempotent-Replayed": "true" },
    });
  }

  // Atomic claim: only the first caller wins the key. A loser is either racing
  // an in-flight request or lost to a just-completed one.
  const won = await kvSetNx(cacheKey, { status: "processing" }, TTL_SECONDS).catch(() => true);
  if (!won) {
    const now = await kvGet<IdempotencyRecord>(cacheKey).catch(() => null);
    if (now?.status === "completed" && now.response) {
      return NextResponse.json(now.response.body, {
        status: now.response.status,
        headers: { "Idempotent-Replayed": "true" },
      });
    }
    return NextResponse.json(
      { error: "idempotency_conflict", message: "A request with this Idempotency-Key is already in progress" },
      { status: 409 }
    );
  }

  try {
    const response = await handler();
    // Only a SUCCESSFUL (2xx) result is pinned to the key — that's the one we
    // must never re-execute (double-spend). Errors (4xx validation, 5xx) are
    // left retryable: the claim is released so the same key can try again once
    // the caller fixes the request or the transient fault clears.
    if (response.status < 200 || response.status >= 300) {
      await kvDel(cacheKey).catch(() => {});
      return response;
    }
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      // Non-JSON/streamed success: can't safely replay — release the claim.
      await kvDel(cacheKey).catch(() => {});
      return response;
    }
    await kvSet(cacheKey, { status: "completed", response: { status: response.status, body } }, TTL_SECONDS).catch(
      () => {}
    );
    return response;
  } catch (err) {
    // Handler threw — release the claim so a retry can re-run.
    await kvDel(cacheKey).catch(() => {});
    throw err;
  }
}
