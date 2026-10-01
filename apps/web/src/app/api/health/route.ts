import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";

// GET /api/health — process liveness for the load balancer and the container
// health check (infra/aws/modules/env: ALB target group + ECS task healthCheck).
//
// LIVENESS ONLY, ON PURPOSE. It answers "is this Node process serving
// requests", nothing else. It does not touch Postgres, Redis or any provider:
// if it did, a Supabase or Upstash blip would mark EVERY task unhealthy at
// once and the load balancer would drain the whole fleet — turning a
// dependency degradation into a total outage. Dependency health is
// /api/ops/health (admin-only) and the scheduled /api/cron/health.
//
// Exempt from the origin-verification header (lib/originVerify.ts) because
// ALB health checks go straight to the target and cannot carry it. It returns
// nothing but a constant, so exposing it reveals nothing.
export const dynamic = "force-dynamic";

/**
 * How long the probe waits on the rate limiter before answering anyway.
 *
 * rateLimitOr429 fails open when KV ERRORS, but the KV client has no request
 * timeout, so a KV that HANGS would hold this response past the 5s ALB/ECS
 * probe timeout and fail every task at once. Bounding the wait makes a hung KV
 * behave like an erroring one: fail open, stay healthy.
 */
const RATE_LIMIT_BUDGET_MS = 250;

export async function GET(req: NextRequest) {
  // Generous: the ALB probes from a handful of node IPs every few seconds.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limited = await Promise.race([
    rateLimitOr429(req, "health", { limit: 600, windowMs: 60_000 }),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), RATE_LIMIT_BUDGET_MS);
    }),
  ]);
  clearTimeout(timer);
  if (limited) return limited;
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
