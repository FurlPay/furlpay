import { NextRequest, NextResponse } from "next/server";
import { listPayments } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

// GET /api/payments/history?limit=50 — most recent payments, newest first.
export function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200);
  const payments = listPayments(limit);
  return NextResponse.json({ payments, count: payments.length });
}
