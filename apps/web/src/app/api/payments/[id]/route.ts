import { NextRequest, NextResponse } from "next/server";
import { getPayment } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

// GET /api/payments/:id — payment status (pending_signature | settled |
// refunded | expired | blocked).
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const record = getPayment(params.id);
  if (!record) return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  return NextResponse.json(record);
}
