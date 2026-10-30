// ---------------------------------------------------------------------------
// @furlpay/rate-limit — core types
// ---------------------------------------------------------------------------

/** Rate limiting algorithm. */
export type RateLimitAlgorithm = "sliding-window" | "fixed-window" | "token-bucket";

/** Information extracted from a request for rate limit keying. */
export interface RateLimitRequest {
  /** Client IP address. */
  ip: string;
  /** Request path (e.g. "/api/transfers"). */
  path: string;
  /** HTTP method. */
  method: string;
  /** Request headers. */
  headers: Record<string, string>;
  /** Authenticated user id, if available. */
  userId?: string;
}

/** Rate limit status information. */
export interface RateLimitInfo {
  /** Maximum requests allowed in the window. */
  limit: number;
  /** Requests remaining in the current window. */
  remaining: number;
  /** Unix timestamp (seconds) when the window resets. */
  resetAt: number;
  /** Seconds until the client should retry. */
  retryAfter: number;
}

/** Result of a rate limit check. */
export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Rate limit info for headers. */
  info: RateLimitInfo;
}

/** Configuration for rate limiting. */
export interface RateLimitConfig {
  /** Maximum requests in the window. */
  limit: number;
  /** Window duration in seconds. */
  windowSeconds: number;
  /** Algorithm to use. Default: "sliding-window". */
  algorithm?: RateLimitAlgorithm;
  /** Extract the rate limit key from a request. Default: IP-based. */
  keyGenerator?: (req: RateLimitRequest) => string;
  /** Custom response when rate limited. */
  onRateLimit?: (info: RateLimitInfo) => Response;
  /** Skip rate limiting for certain requests. */
  skip?: (req: RateLimitRequest) => boolean;
}

/**
 * Storage backend for rate limit state.
 *
 * Implementations must be safe for concurrent use within a single process.
 * For multi-process/multi-instance deployments, use a Redis-backed store.
 */
export interface RateLimitStore {
  /** Increment the counter for a key. Returns current count and reset time. */
  increment(key: string, windowSeconds: number): Promise<{ count: number; resetAt: number }>;
  /** Check current count without incrementing. */
  peek(key: string): Promise<{ count: number; resetAt: number } | null>;
}
