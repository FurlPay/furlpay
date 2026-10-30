// ---------------------------------------------------------------------------
// Common rate limit presets for FurlPay API routes.
//
// These are starting points — tune them based on production traffic patterns
// and abuse signals. The presets use sliding-window by default because it
// gives the smoothest behavior at window boundaries.
// ---------------------------------------------------------------------------

import type { RateLimitConfig } from "./types.js";

export const PRESETS = {
  /** General API endpoints: 100 req/min. */
  api: {
    limit: 100,
    windowSeconds: 60,
    algorithm: "sliding-window",
  } satisfies RateLimitConfig,

  /** Authentication endpoints (login, register, OTP): 5 req/min. */
  auth: {
    limit: 5,
    windowSeconds: 60,
    algorithm: "fixed-window",
  } satisfies RateLimitConfig,

  /** Payment/transfer endpoints: 10 req/min. */
  payment: {
    limit: 10,
    windowSeconds: 60,
    algorithm: "sliding-window",
  } satisfies RateLimitConfig,

  /** Webhook receivers (Anchorage, Stripe, etc.): 1000 req/min. */
  webhook: {
    limit: 1000,
    windowSeconds: 60,
    algorithm: "sliding-window",
  } satisfies RateLimitConfig,

  /** Public read-only endpoints (prices, status): 200 req/min. */
  publicRead: {
    limit: 200,
    windowSeconds: 60,
    algorithm: "sliding-window",
  } satisfies RateLimitConfig,

  /** Agent/bot API endpoints: 30 req/min per agent. */
  agent: {
    limit: 30,
    windowSeconds: 60,
    algorithm: "token-bucket",
  } satisfies RateLimitConfig,

  /** Admin endpoints: 20 req/min. */
  admin: {
    limit: 20,
    windowSeconds: 60,
    algorithm: "fixed-window",
  } satisfies RateLimitConfig,
} as const;

/**
 * Default route-to-preset mapping for FurlPay's Next.js API routes.
 *
 * This maps API route prefixes to presets. Use with `routeRateLimit()`:
 * ```typescript
 * import { routeRateLimit, FURLPAY_ROUTE_LIMITS, PRESETS } from "@furlpay/rate-limit";
 * const limiter = routeRateLimit(FURLPAY_ROUTE_LIMITS, PRESETS.api);
 * ```
 */
export const FURLPAY_ROUTE_LIMITS: Record<string, RateLimitConfig> = {
  "/api/auth": PRESETS.auth,
  "/api/transfers": PRESETS.payment,
  "/api/payments": PRESETS.payment,
  "/api/webhooks": PRESETS.webhook,
  "/api/agent": PRESETS.agent,
  "/api/admin": PRESETS.admin,
  "/api/prices": PRESETS.publicRead,
  "/api/health": PRESETS.publicRead,
};
