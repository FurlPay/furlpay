import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { screenAddress } from "@/lib/services/compliance";
import { routeInboundDeposit } from "@/lib/services/compliance-routing";
import { db } from "@/lib/store";
import { rateLimitOr429 } from "@/lib/rateLimit";

// GET /api/compliance?address=0x...  → wallet risk screen
export async function GET(req: NextRequest) {
  const rl = await rateLimitOr429(req, "compliance.screen", { limit: 30, windowMs: 60_000 });
  if (rl) return rl;

  const address = req.nextUrl.searchParams.get("address");
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });
  return NextResponse.json({ result: screenAddress(address) });
}

const DepositBody = z.object({
  token: z.enum(["USDC", "USDT", "EURC", "XSGD", "DAI", "PYUSD"]),
});

// POST /api/compliance — MiCA-aware inbound deposit routing.
export async function POST(req: NextRequest) {
  const rl = await rateLimitOr429(req, "compliance.deposit", { limit: 20, windowMs: 60_000 });
  if (rl) return rl;

  const parsed = DepositBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.errors }, { status: 400 });
  }
  const decision = routeInboundDeposit(parsed.data.token, db.user.region);
  return NextResponse.json({ decision });
}
