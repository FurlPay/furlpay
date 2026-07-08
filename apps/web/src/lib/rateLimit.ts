import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Sliding-window rate limiter for sensitive endpoints (OTP, payments, funding,
// key registration). In-memory per instance — production swaps the store for
// Redis (Upstash Ratelimit) behind the same limit() signature. Even the
// in-memory version blunts brute force and SMS-pumping from a single instance
// and bounds its own memory.
// ---------------------------------------------------------------------------

interface Bucket {
  hits: number[]; // timestamps (ms) within the window, oldest first
}

const MAX_KEYS = 50_000; // hard memory bound

const g = globalThis as unknown as { __rateBuckets?: Map<string, Bucket> };
const buckets = (): Map<string, Bucket> => (g.__rateBuckets ??= new Map());

export interface RateLimitOptions {
  /** Max requests allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function limit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const store = buckets();

  let bucket = store.get(key);
  if (!bucket) {
    if (store.size >= MAX_KEYS) evictStale(store, now, opts.windowMs);
    bucket = { hits: [] };
    store.set(key, bucket);
  }

  // Drop hits that fell out of the window.
  const cutoff = now - opts.windowMs;
  while (bucket.hits.length && bucket.hits[0] <= cutoff) bucket.hits.shift();

  if (bucket.hits.length >= opts.limit) {
    const retryAfterMs = bucket.hits[0] + opts.windowMs - now;
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  bucket.hits.push(now);
  return { ok: true, remaining: opts.limit - bucket.hits.length, retryAfterSeconds: 0 };
}

function evictStale(store: Map<string, Bucket>, now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  for (const [key, bucket] of store) {
    if (!bucket.hits.length || bucket.hits[bucket.hits.length - 1] <= cutoff) store.delete(key);
    if (store.size < MAX_KEYS / 2) break;
  }
}

/** Best-effort client IP (Vercel sets x-forwarded-for; first hop is client). */
export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Route helper: returns a 429 response when over limit, else null.
 * Key by IP plus any stable identifier (phone, user id) so one attacker can't
 * exhaust another user's budget, and one user can't rotate IPs freely.
 */
export function rateLimitOr429(
  req: NextRequest,
  name: string,
  opts: RateLimitOptions,
  extraKey = ""
): NextResponse | null {
  const result = limit(`${name}:${clientIp(req)}:${extraKey}`, opts);
  if (result.ok) return null;
  return NextResponse.json(
    { error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
  );
}
