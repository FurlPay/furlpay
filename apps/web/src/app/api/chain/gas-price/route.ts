import { NextResponse } from "next/server";
import { CHAIN_REGISTRY, gasQuote } from "@/lib/services/chainRegistry";

export const dynamic = "force-dynamic";

// GET /api/chain/gas-price — current gas price per supported chain plus the
// USD cost of a simple USDC transfer at that price. Public: merchants use it
// to sanity-check Furlpay's 0.5% fee vs card interchange.
export async function GET() {
  const quotes = await Promise.all(CHAIN_REGISTRY.map(gasQuote));
  return NextResponse.json({ quotes, updatedAt: new Date().toISOString() });
}
