import { NextRequest, NextResponse } from "next/server";
import { kvBackend, kvErrorCategory, kvIncr } from "./kv";
import { log } from "./log";
import { trustedClientIp } from "./clientIp";

// ---------------------------------------------------------------------------
// Rate limiter for sensitive endpoints (OTP, payments, funding, key
// registration, public Actions). Two backends behind one signature:
//   - Redis (Upstash): fixed-window counters on window-stamped keys
//     (`rl:{name}:{window}`) — GLOBAL across serverless instances, which is
//     what actually stops brute force and SMS pumping in production.
//   - In-memory sliding window: dev/demo fallback, correct per instance.
// Limiting must never take an endpoint down: a Redis error degrades to the
// in-memory window (bounded per instance), never to no limit at all.
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
  /** Set when the request was refused because the GLOBAL counter could not be read. */
  storeUnavailable?: boolean;
}

// ---------------------------------------------------------------------------
// WHICH LIMITS FAIL CLOSED.
//
// The per-instance fallback below keeps most endpoints up through a Redis
// outage, and for reads that is right. For the buckets matched here it is not:
// serverless runs many instances, each with its own fresh window, so "5 OTPs
// per 10 minutes" becomes 5 per instance — SMS pumping and credential stuffing
// scale with the instance count. These refuse (503) until the global counter
// is back. Matched by bucket NAME, so the policy is reviewed here, in one
// list, instead of drifting across sixty route files.
//
// The consequence is deliberate and should be known before a deploy: during
// a Redis outage, sign-in, step-up and money movement stop. They already
// depend on Redis for OTP codes, sessions and step-up state; this only stops
// the limiter from being the one piece that pretends otherwise.
// ---------------------------------------------------------------------------
const FAIL_CLOSED_BUCKETS: RegExp[] = [
  // Authentication and step-up
  /^otp\./,
  /^auth\.(passkey|webauthn|apple|google|native|handoff|telegram)/,
  // Binding a Telegram identity to an account adds a sign-in method.
  /^miniapp\.telegram-link$/,
  /^actions\.step_up\./,
  /^security\.mfa$/,
  /^wallet\.link\./,
  /^wallets\.biometric_pay\./,
  /^attestation\.challenge$/,
  // Money movement and its authorization
  /^payments\.(create|execute|batch|stripe\.intent)$/,
  /^payouts\.payroll$/,
  /^v1\.(payments\.(authorize|execute)|mandates\.create)$/,
  /^wallets?\.(transfer|authorize|circle\.(transfer|challenge))$/,
  /^transfers[.-]/,
  /^swaps\.execute$/,
  /^(onramp|offramp)\.session$/,
  /^offramp$/,
  /^account\.(fund|spend)$/,
  /^earn\.(deposit|withdraw)$/,
  /^bills\.pay$/,
  /^p2p\.orders\.(create|pay|release)$/,
  /^mpc\.sign$/,
  /^intents\.cctp$/,
  /^investing\.orders$/,
  /^travel\.(book|settle)$/,
  /^x402\.(facilitator\.settle|policy\.settle|checkout\.pay)$/,
  /^(giftcards|gifts\.vouchers)\.redeem$/,
  // Unauthenticated endpoints that SEND EMAIL (mail pumping scales with the
  // instance count exactly like SMS does)
  /^content\.report_download$/,
  /^partnerships\.inquiry$/,
  // Card secrets and credentials
  /^cards\.(reveal|pin\.(set|verify)|issue)$/,
  /^developer\.keys\.(create|rotate)$/,
];

export function failsClosed(bucket: string): boolean {
  return FAIL_CLOSED_BUCKETS.some((re) => re.test(bucket));
}

/** How long a fail-closed refusal asks the client to wait. */
const STORE_UNAVAILABLE_RETRY_SECONDS = 30;

export async function limit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  if (kvBackend === "redis") {
    try {
      const windowSeconds = Math.max(1, Math.ceil(opts.windowMs / 1000));
      const now = Math.floor(Date.now() / 1000);
      const window = Math.floor(now / windowSeconds);
      const count = await kvIncr(`rl:${key}:${window}`, windowSeconds);
      if (count > opts.limit) {
        return { ok: false, remaining: 0, retryAfterSeconds: (window + 1) * windowSeconds - now || 1 };
      }
      return { ok: true, remaining: opts.limit - count, retryAfterSeconds: 0 };
    } catch (e) {
      // Redis is unreachable. Do not drop the limit: this used to return ok
      // unconditionally, so a Redis outage removed every throttle (OTP,
      // login, payments) at once.
      //   - Sensitive buckets (FAIL_CLOSED_BUCKETS) refuse until it is back.
      //   - Everything else degrades to the per-instance window, which still
      //     bounds each instance; the global limit resumes when Redis does.
      const bucket = key.split(":", 1)[0];
      if (failsClosed(bucket)) {
        log.error("rate limit store unavailable; refusing sensitive request", {
          bucket,
          category: kvErrorCategory(e),
        });
        return { ok: false, remaining: 0, retryAfterSeconds: STORE_UNAVAILABLE_RETRY_SECONDS, storeUnavailable: true };
      }
      return memoryLimit(key, opts);
    }
  }
  return memoryLimit(key, opts);
}

function memoryLimit(key: string, opts: RateLimitOptions): RateLimitResult {
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

/**
 * Rate-limit identity for a request: the trusted client IP (lib/clientIp.ts).
 *
 * When trust cannot be established (null), every such request shares ONE
 * strict bucket per route, still split by the route's extraKey (user id,
 * phone). Deliberately harsh: under the deployed topology it cannot happen
 * (the proxies always append and nothing else reaches the task), so a null
 * means misconfiguration or a bypass attempt, and neither may earn a fresh
 * budget per request. A per-request random key would disable limiting; a
 * client-supplied value would let the attacker choose the bucket.
 */
export function rateLimitIdentity(req: Pick<Request, "headers"> | undefined): string {
  return trustedClientIp(req) ?? "untrusted";
}

/**
 * Quota headers for a rate-limited response. Emits both the widely-consumed
 * legacy trio (X-RateLimit-Limit/Remaining/Reset — Stripe/GitHub/Coinbase) and
 * the IETF structured field (RateLimit / RateLimit-Policy,
 * draft-ietf-httpapi-ratelimit-headers) for forward compatibility.
 * `resetSeconds` is seconds until the window resets.
 */
export function rateLimitHeaders(limitVal: number, remaining: number, resetSeconds: number): Record<string, string> {
  const rem = Math.max(0, remaining);
  const reset = Math.max(0, Math.ceil(resetSeconds));
  return {
    "X-RateLimit-Limit": String(limitVal),
    "X-RateLimit-Remaining": String(rem),
    "X-RateLimit-Reset": String(reset),
    RateLimit: `limit=${limitVal}, remaining=${rem}, reset=${reset}`,
    "RateLimit-Policy": `${limitVal};w=${reset || limitVal}`,
  };
}

/**
 * Route helper: returns a 429 response when over limit, else null.
 * Key by IP plus any stable identifier (phone, user id) so one attacker can't
 * exhaust another user's budget, and one user can't rotate IPs freely.
 */
export async function rateLimitOr429(
  req: NextRequest | undefined,
  name: string,
  opts: RateLimitOptions,
  extraKey = ""
): Promise<NextResponse | null> {
  const result = await limit(`${name}:${rateLimitIdentity(req)}:${extraKey}`, opts);
  if (result.ok) return null;
  if (result.storeUnavailable) {
    // 503, not 429: the client did nothing wrong, and a 429 would tell it so.
    return NextResponse.json(
      { error: "temporarily_unavailable", detail: "Please try again shortly.", retryAfterSeconds: result.retryAfterSeconds },
      { status: 503, headers: { "Retry-After": String(result.retryAfterSeconds) } }
    );
  }
  const windowSeconds = Math.ceil(opts.windowMs / 1000);
  return NextResponse.json(
    { error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        ...rateLimitHeaders(opts.limit, 0, result.retryAfterSeconds || windowSeconds),
      },
    }
  );
}
