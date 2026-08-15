import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { listResources } from "@/lib/x402Registry";

export const dynamic = "force-dynamic";

// GET /api/x402/resources — public catalog of pay-per-call resources. AI
// agents crawl this to discover what Furlpay sells and at what price. The
// standard x402 "Bazaar" discovery layer serves the same catalog in the
// machine-readable format facilitators crawl — linked here so agents that speak
// the spec can pick it up automatically.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "x402.resources", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  return NextResponse.json({
    resources: listResources(),
    discovery: "/api/x402/discovery/resources",
  });
}
