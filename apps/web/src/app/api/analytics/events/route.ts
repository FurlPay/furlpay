import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { LIMITS } from "@/lib/analytics/contract";
import { hasCredential, ingestResponse } from "@/lib/analytics/ingestHttp";

export const dynamic = "force-dynamic";

// POST /api/analytics/events — ONE client analytics event (web, chrome_extension,
// android, ios). Anonymous or signed in. The payload is validated against the
// shared contract (lib/analytics/contract.ts); identity comes from the session.
// Informational only: nothing here moves money, approves KYC or settles.
const Body = z.record(z.unknown());

export async function POST(req: NextRequest) {
  // Anonymous traffic gets a tight budget per IP; signed-in clients a wider one.
  const limited = hasCredential(req)
    ? await rateLimitOr429(req, "analytics.events.user", { limit: 120, windowMs: 60_000 })
    : await rateLimitOr429(req, "analytics.events.anon", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await validateBody(req, Body, { maxBytes: 4 * 1024 });
  if (body instanceof NextResponse) return body;
  return ingestResponse(req, [body].slice(0, LIMITS.batchMaxEvents));
}
