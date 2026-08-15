import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { CHAIN_REGISTRY, gasQuote } from "@/lib/services/chainRegistry";

export const dynamic = "force-dynamic";

// GET /api/chain/gas-price — current gas price per supported chain plus the
// USD cost of a simple USDC transfer at that price. Public: merchants use it
// to sanity-check Furlpay's 0.5% fee vs card interchange.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "chain.gas.price", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const quotes = await Promise.all(CHAIN_REGISTRY.map(gasQuote));
  return NextResponse.json({ quotes, updatedAt: new Date().toISOString() });
}
