import { NextRequest, NextResponse } from "next/server";
import { getPayment } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

// GET /api/payments/:id — payment status (pending_signature | settled |
// refunded | expired | blocked).
export function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const record = getPayment(params.id);
  if (!record) return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  return NextResponse.json(record);
}
