import { NextRequest, NextResponse } from "next/server";
import { createCryptoPaymentIntent } from "@/lib/payments/stripe";

// POST /api/payments/stripe/intent — create a stablecoin-enabled PaymentIntent
// for a Furlpay Connect checkout. Body: { amountInCents: number, currency?: string }
// Returns the client secret consumed by Stripe Elements on the frontend.
export async function POST(req: NextRequest) {
  const { amountInCents, currency } = await req.json().catch(() => ({}));

  if (!Number.isInteger(amountInCents) || amountInCents <= 0) {
    return NextResponse.json({ error: "amountInCents must be a positive integer" }, { status: 400 });
  }

  try {
    const intent = await createCryptoPaymentIntent(amountInCents, currency || "usd");
    return NextResponse.json(intent);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Stripe error" }, { status: 502 });
  }
}
