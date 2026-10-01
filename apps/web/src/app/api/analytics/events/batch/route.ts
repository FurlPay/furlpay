import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { LIMITS } from "@/lib/analytics/contract";
import { hasCredential, ingestResponse } from "@/lib/analytics/ingestHttp";

export const dynamic = "force-dynamic";

// POST /api/analytics/events/batch — up to 50 client events in one request
// (mobile offline queues, the extension's background flush). Bounded count,
// bounded bytes, bounded event age (contract.ts LIMITS). Same identity, same
// validation and same idempotency as the single-event route.
const Body = z.object({ events: z.array(z.unknown()).min(1).max(LIMITS.batchMaxEvents) }).strict();

export async function POST(req: NextRequest) {
  const limited = hasCredential(req)
    ? await rateLimitOr429(req, "analytics.batch.user", { limit: 30, windowMs: 60_000 })
    : await rateLimitOr429(req, "analytics.batch.anon", { limit: 6, windowMs: 60_000 });
  if (limited) return limited;
  const body = await validateBody(req, Body, { maxBytes: LIMITS.bodyMaxBytes });
  if (body instanceof NextResponse) return body;
  return ingestResponse(req, body.events);
}
