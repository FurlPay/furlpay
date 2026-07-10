import { NextResponse } from "next/server";
import { buildSpendingSummary } from "@/lib/services/spendingSummary";

export const dynamic = "force-dynamic";

// GET /api/reports/spending — rolling 7-day spending summary with a generated
// narrative (Auto Commentary). Session-gated by middleware.
export function GET() {
  return NextResponse.json(buildSpendingSummary());
}
