// ---------------------------------------------------------------------------
// @furlpay/rate-limit — barrel exports
// ---------------------------------------------------------------------------

// Types
export type {
  RateLimitAlgorithm,
  RateLimitRequest,
  RateLimitInfo,
  RateLimitResult,
  RateLimitConfig,
  RateLimitStore,
} from "./src/types.js";

// Stores
export { MemoryRateLimitStore } from "./src/stores/memory.js";
// Redis store is a separate export path: "@furlpay/rate-limit/redis"

// Middleware
export {
  rateLimit,
  rateLimitHeaders,
  rateLimitResponse,
  routeRateLimit,
  type RouteRateLimitMap,
} from "./src/middleware.js";

// Presets
export { PRESETS, FURLPAY_ROUTE_LIMITS } from "./src/presets.js";
