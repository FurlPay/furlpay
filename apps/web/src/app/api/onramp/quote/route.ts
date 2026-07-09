import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { quoteOnramp } from "@/lib/services/onramp";

export const dynamic = "force-dynamic";

// POST /api/onramp/quote — headless on-ramp quote (fiat → crypto). Public
// (publishable-key) surface consumed by @furlpay/elements/onramp.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onramp.quote", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const b = await req.json().catch(() => ({}));
  const fiatAmount = Number(b?.fiatAmount);
  if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
    return NextResponse.json({ error: "fiatAmount must be positive" }, { status: 400 });
  }
  return NextResponse.json(
    quoteOnramp({
      fiatAmount,
      fiatCurrency: String(b?.fiatCurrency ?? "USD").toUpperCase(),
      token: String(b?.token ?? "USDC"),
      chain: String(b?.chain ?? "arbitrum"),
      paymentMethod: String(b?.paymentMethod ?? "card"),
    }),
  );
}
