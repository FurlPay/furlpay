import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { screenAddress } from "@/lib/services/compliance";
import { routeInboundDeposit } from "@/lib/services/compliance-routing";
import { requireUser } from "@/lib/authz";
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
  // The routing decision depends on the CALLER's KYC region. It used to read
  // the seeded demo account's ("EEA") for everyone, telling US and Indian users
  // their USDT deposit would be auto-swapped to EURC under MiCA.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const rl = await rateLimitOr429(req, "compliance.deposit", { limit: 20, windowMs: 60_000 });
  if (rl) return rl;

  const parsed = DepositBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.errors }, { status: 400 });
  }
  const decision = routeInboundDeposit(parsed.data.token, auth.account.user.region);
  return NextResponse.json({ decision });
}
