import { NextRequest, NextResponse } from "next/server";
import { createOnrampSession } from "@/lib/services/onramp";

export const dynamic = "force-dynamic";

// POST /api/onramp/session — mint a headless on-ramp session the partner
// confirms with its own payment sheet. Consumed by @furlpay/elements/onramp.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const fiatAmount = Number(b?.fiatAmount);
  const destinationAddress = String(b?.destinationAddress ?? "");
  if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
    return NextResponse.json({ error: "fiatAmount must be positive" }, { status: 400 });
  }
  if (!/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(destinationAddress)) {
    return NextResponse.json({ error: "valid destinationAddress required" }, { status: 400 });
  }
  const session = createOnrampSession({
    fiatAmount,
    fiatCurrency: String(b?.fiatCurrency ?? "USD").toUpperCase(),
    token: String(b?.token ?? "USDC"),
    chain: String(b?.chain ?? "arbitrum"),
    paymentMethod: String(b?.paymentMethod ?? "card"),
    destinationAddress,
    externalId: typeof b?.externalId === "string" ? b.externalId : undefined,
  });
  return NextResponse.json(session, { status: 201 });
}
