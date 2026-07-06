import { NextResponse } from "next/server";
import { listResources } from "@/lib/x402Registry";

export const dynamic = "force-dynamic";

// GET /api/x402/resources — public catalog of pay-per-call resources. AI
// agents crawl this to discover what Furlpay sells and at what price. The
// standard x402 "Bazaar" discovery layer serves the same catalog in the
// machine-readable format facilitators crawl — linked here so agents that speak
// the spec can pick it up automatically.
export function GET() {
  return NextResponse.json({
    resources: listResources(),
    discovery: "/api/x402/discovery/resources",
  });
}
