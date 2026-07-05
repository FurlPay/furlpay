import { NextResponse } from "next/server";
import { listResources } from "@/lib/x402Registry";

export const dynamic = "force-dynamic";

// GET /api/x402/resources — public catalog of pay-per-call resources. AI
// agents crawl this to discover what Furlpay sells and at what price.
export function GET() {
  return NextResponse.json({ resources: listResources() });
}
