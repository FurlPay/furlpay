import { NextResponse } from "next/server";
import { buildPnl } from "@/lib/services/reports";

export const dynamic = "force-dynamic";

// GET /api/reports/pnl — unified profit & loss across equities (unrealized),
// crypto disposals (realized) and cashback income. Session-gated by middleware.
export function GET() {
  return NextResponse.json(buildPnl());
}
