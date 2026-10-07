import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { readiness } from "@/lib/health/readiness";

// GET /api/health/ready — READINESS for an external uptime monitor: can this
// deployment safely serve sign-in and money movement right now?
//
// /api/health stays liveness-only (the ALB must not drain the fleet over a
// dependency blip). This route is the one to alert on: it returns 503 when a
// dependency that the fail-closed paths need is unavailable. The 7 Oct 2026
// outage (Upstash over its plan limit: every sign-in and payment 503) was
// invisible because only liveness was public.
//
//   kv        a WRITE then a read: Upstash's plan/storage limits reject writes
//             while reads still succeed, so a read-only probe stays green over
//             a store that can no longer hold an OTP or a rate-limit counter.
//   database  one indexed single-row read.
//
// Results are cached per instance for CACHE_MS, so a monitor polling every few
// seconds costs at most one probe (two KV commands) per instance per window.
// Only statuses and a coarse category leave the process, never provider text.

export const dynamic = "force-dynamic";

const RATE_LIMIT_BUDGET_MS = 250;

export async function GET(req: NextRequest) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limited = await Promise.race([
    rateLimitOr429(req, "health.ready", { limit: 120, windowMs: 60_000 }),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), RATE_LIMIT_BUDGET_MS);
    }),
  ]);
  clearTimeout(timer);
  if (limited) return limited;
  const snap = await readiness();
  return NextResponse.json(snap, { status: snap.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
