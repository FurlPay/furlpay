import { NextRequest, NextResponse } from "next/server";
import { screenAddress } from "@/lib/services/compliance";
import { routeInboundDeposit } from "@/lib/services/compliance-routing";
import { db } from "@/lib/store";
import { Stablecoin } from "@/lib/types";

// GET /api/compliance?address=0x...  → wallet risk screen
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });
  return NextResponse.json({ result: screenAddress(address) });
}

// POST /api/compliance — MiCA-aware inbound deposit routing.
// body: { token }
export async function POST(req: NextRequest) {
  const { token } = (await req.json()) as { token: Stablecoin };
  const decision = routeInboundDeposit(token, db.user.region);
  return NextResponse.json({ decision });
}
