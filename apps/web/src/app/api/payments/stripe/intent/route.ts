import { NextRequest, NextResponse } from "next/server";
import { createCryptoPaymentIntent } from "@/lib/payments/stripe";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { z } from "zod";
import { validateBody } from "@/lib/validate";

// AGENTS rule 1: money amounts are positive AND bounded. This public route had
// no ceiling and passed any currency string to Stripe; the Stripe webhook only
// ever credits USD, so a non-USD intent could be paid and never credited.
const MAX_INTENT_CENTS = 5_000_000; // $50,000, the ramp ceiling
const IntentSchema = z.object({
  amountInCents: z.number().int().positive().max(MAX_INTENT_CENTS),
  currency: z.literal("usd").optional(),
});

// POST /api/payments/stripe/intent — create a stablecoin-enabled PaymentIntent
// for a Furlpay Connect checkout. Body: { amountInCents: number, currency?: string }
// Returns the client secret consumed by Stripe Elements on the frontend.
export async function POST(req: NextRequest) {
  // Public merchant-checkout endpoint that creates a real Stripe object per
  // call — rate-limit it well below the middleware baseline so an anonymous
  // caller can't mint PaymentIntents in bulk against our Stripe account.
  const limited = await rateLimitOr429(req, "payments.stripe.intent", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, IntentSchema);
  if (body instanceof NextResponse) return body;
  const { amountInCents } = body;

  try {
    const intent = await createCryptoPaymentIntent(amountInCents, "usd");
    return NextResponse.json(intent);
  } catch (err: any) {
    console.error("[stripe/intent] create failed:", err?.message);
    return NextResponse.json({ error: "payment_provider_error" }, { status: 502 });
  }
}
