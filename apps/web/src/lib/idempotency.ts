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
  /** Canonical hash of the first request body seen under this key. */
  requestHash?: string;
}

/**
 * The cache key. `principal` is a SEPARATE, MANDATORY argument rather than
 * something the caller interpolates into `scope`, and that is the whole point.
 *
 * THE BUG THIS SHAPE PREVENTS. Every money route wrote its scope by hand as
 * `cards.order:${account.user.id}`, so tenant isolation depended on each author
 * remembering the convention. One did not: /api/topup/apple-pay passed the bare
 * string "topup.applePay". Two users who both sent `Idempotency-Key: abc` to
 * that endpoint therefore collided — the second received the FIRST user's
 * cached 2xx response, meaning their own card was never charged while they were
 * told it had been, and they were shown another user's capture result.
 *
 * A convention that is followed 18 times out of 19 is not a control. Making the
 * principal a required parameter turns that omission into a compile error.
 */
const cacheKeyFor = (scope: string, principal: string, key: string) =>
  `idem:${scope}:${principal}:${key}`;

/**
 * Canonical hash of a request body, for detecting key reuse.
 *
 * Keys are sorted at every level before hashing, because `{a:1,b:2}` and
 * `{b:2,a:1}` are the same request and a raw JSON.stringify would call them
 * different — producing a false conflict on a legitimate retry, which is worse
 * than the problem being solved.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/** FNV-1a over the canonical form. Not a security primitive — it only needs to
 *  detect an accidentally reused key, and it must run on the Edge runtime
 *  without pulling in node:crypto. */
export function hashRequest(body: unknown): string {
  const text = canonicalize(body);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Run `handler` at most once per (scope, key). Pass the `Idempotency-Key`
 * header value; when absent, the handler runs normally (no dedup). `scope`
 * namespaces keys per route so the same client key can't collide across
 * endpoints (e.g. "wallets.transfer").
 */
export interface IdempotencyOptions {
  /**
   * The authenticated principal this key belongs to. REQUIRED.
   *
   * Idempotency keys are chosen by clients, so `order_123` from one account and
   * `order_123` from another are unrelated requests that must never share a
   * cache entry. See `cacheKeyFor` for the production bug this parameter
   * exists to make impossible.
   */
  principal: string;
  /**
   * The parsed request body, when the caller has it.
   *
   * Supplying it enables reuse detection: a second request under the same key
   * carrying a DIFFERENT body is rejected rather than silently answered with
   * the first result. Omitting it keeps the previous behaviour — replay on key
   * alone — which is correct for routes that claim the key before parsing.
   */
  request?: unknown;
}

/**
 * Read-only lookup of an idempotency record, for RECONCILIATION.
 *
 * A mobile client whose reply was lost to a timeout knows only the key it
 * submitted under. This resolves that key to the authoritative outcome the
 * server already recorded, so the client can settle an unknown state instead
 * of re-submitting and risking a second payment.
 *
 * SECURITY: `principal` is a required argument and is part of the cache key, so
 * this can only ever read a record the CALLING user created. There is no code
 * path here that takes a raw cache key from a request. The caller must pass the
 * authenticated user's id — never a value from the request body.
 *
 * Returns `null` when the key is unknown, which is a legitimate answer: the
 * request may never have reached the server at all.
 */
export async function readIdempotencyRecord(
  key: string,
  scope: string,
  principal: string
): Promise<{ status: "processing" | "completed"; response?: { status: number; body: unknown } } | null> {
  if (!key || key.length > KEY_MAX) return null;
  const record = await kvGet<IdempotencyRecord>(cacheKeyFor(scope, principal, key)).catch(() => null);
  if (!record) return null;
  // The stored request hash is deliberately NOT returned: it is an internal
  // conflict-detection detail and echoing it back tells a caller nothing they
  // need and confirms the shape of a request they may not have made.
  return record.status === "completed" && record.response
    ? { status: "completed", response: record.response }
    : { status: "processing" };
}

export async function withIdempotency(
  key: string | null | undefined,
  scope: string,
  handler: () => Promise<NextResponse>,
  options: IdempotencyOptions
): Promise<NextResponse> {
  if (!key) return handler();
  if (key.length > KEY_MAX) {
    return NextResponse.json(
      { error: "invalid_idempotency_key", message: `Idempotency-Key exceeds ${KEY_MAX} chars` },
      { status: 400 }
    );
  }
  const cacheKey = cacheKeyFor(scope, options.principal, key);
  const requestHash = options.request === undefined ? undefined : hashRequest(options.request);

  // Fast path: a completed result is replayed without touching the handler.
  const existing = await kvGet<IdempotencyRecord>(cacheKey).catch(() => null);
  if (existing?.status === "completed" && existing.response) {
    const mismatch = conflictIfReused(existing, requestHash);
    if (mismatch) return mismatch;
    return NextResponse.json(existing.response.body, {
      status: existing.response.status,
      headers: { "Idempotent-Replayed": "true" },
    });
  }
  // A key already in flight with a different body is the same mistake, caught
  // one moment earlier.
  if (existing?.status === "processing") {
    const mismatch = conflictIfReused(existing, requestHash);
    if (mismatch) return mismatch;
  }

  // Atomic claim: only the first caller wins the key. A loser is either racing
  // an in-flight request or lost to a just-completed one.
  //
  // FAIL CLOSED when the store cannot answer. This used to treat a KV error
  // as "won", so during a Redis outage (production, 2026-10-02: every command
  // 403 'Fixed plan limits') a retried transfer, spend or redemption ran the
  // handler again with no duplicate protection. A caller that sends an
  // Idempotency-Key is asking for at-most-once execution; when that cannot be
  // guaranteed the honest answer is "not now", and retrying later is safe
  // because nothing ran.
  let won: boolean;
  try {
    won = await kvSetNx(cacheKey, { status: "processing", requestHash }, TTL_SECONDS);
  } catch {
    return NextResponse.json(
      { error: "idempotency_unavailable", message: "Duplicate protection is temporarily unavailable; nothing was executed. Retry shortly with the same Idempotency-Key." },
      { status: 503, headers: { "Retry-After": "30" } }
    );
  }
  if (!won) {
    const now = await kvGet<IdempotencyRecord>(cacheKey).catch(() => null);
    // Re-checked HERE, not only on the fast path above.
    //
    // Under real concurrency both callers read the key as absent before either
    // claims it, so the earlier check cannot fire — the loser only learns the
    // key is taken from kvSetNx. That makes this the branch where a concurrent
    // reuse is actually caught, and omitting the comparison here would let two
    // simultaneous requests with DIFFERENT bodies resolve as a replay.
    if (now) {
      const mismatch = conflictIfReused(now, requestHash);
      if (mismatch) return mismatch;
    }
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
    await kvSet(
      cacheKey,
      { status: "completed", response: { status: response.status, body }, requestHash },
      TTL_SECONDS
    ).catch(() => {});
    return response;
  } catch (err) {
    // Handler threw — release the claim so a retry can re-run.
    await kvDel(cacheKey).catch(() => {});
    throw err;
  }
}

/**
 * A stored record whose request differs from the one now presented.
 *
 * This is the case Stripe answers with 422, and the reason it matters is that
 * the alternative is silent and expensive: a client that reuses `order_123`
 * for a $1,000 payment after a $100 one would otherwise be handed the $100
 * receipt and told it succeeded. The $1,000 never happens, and nothing
 * anywhere reports a problem.
 *
 * Returns null when there is nothing to compare — either the caller did not
 * supply a body, or the record predates hashing. Silence there is deliberate:
 * an unknown hash must not manufacture a conflict on a legitimate retry.
 */
function conflictIfReused(
  record: IdempotencyRecord,
  requestHash: string | undefined
): NextResponse | null {
  if (!requestHash || !record.requestHash) return null;
  if (record.requestHash === requestHash) return null;
  return NextResponse.json(
    {
      error: "idempotency_key_reused",
      message:
        "This Idempotency-Key was already used for a different request. Use a new key for a new operation.",
    },
    { status: 422 }
  );
}
