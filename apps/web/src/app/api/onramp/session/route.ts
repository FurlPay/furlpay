import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { createOnrampSession } from "@/lib/services/onramp";
import { coinbaseOnrampUrl } from "@/lib/services/coinbaseRamp";

export const dynamic = "force-dynamic";

// POST /api/onramp/session — mint a headless on-ramp session the partner
// confirms with its own payment sheet. Consumed by @furlpay/elements/onramp.
// When CDP credentials are configured, the response also carries a Coinbase-
// hosted checkout URL (0% provider fees on USDC) as the preferred live path.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onramp.session", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  const b = await req.json().catch(() => ({}));
  const fiatAmount = Number(b?.fiatAmount);
  const destinationAddress = String(b?.destinationAddress ?? "");
  if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
    return NextResponse.json({ error: "fiatAmount must be positive" }, { status: 400 });
  }
  if (!/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(destinationAddress)) {
    return NextResponse.json({ error: "valid destinationAddress required" }, { status: 400 });
  }
  const chain = String(b?.chain ?? "arbitrum");
  const token = String(b?.token ?? "USDC");
  const session = createOnrampSession({
    fiatAmount,
    fiatCurrency: String(b?.fiatCurrency ?? "USD").toUpperCase(),
    token,
    chain,
    paymentMethod: String(b?.paymentMethod ?? "card"),
    destinationAddress,
    externalId: typeof b?.externalId === "string" ? b.externalId : undefined,
  });

  // Hosted leg is best-effort: a CDP hiccup must not take down the demo flow.
  let hosted = null;
  try {
    hosted = await coinbaseOnrampUrl({
      address: destinationAddress,
      chain,
      asset: token,
      fiatAmount,
      fiatCurrency: String(b?.fiatCurrency ?? "USD").toUpperCase(),
      partnerUserRef: session.id,
    });
  } catch (e) {
    console.error("[onramp] coinbase hosted url failed:", (e as Error).message);
  }
  return NextResponse.json({ ...session, hosted }, { status: 201 });
}
