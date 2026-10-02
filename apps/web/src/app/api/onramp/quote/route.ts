import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { OnrampQuoteSchema } from "@/lib/schemas";
import { quoteOnramp } from "@/lib/services/onramp";
import { coinbaseBuyQuote, coinbaseRampBackend } from "@/lib/services/coinbaseRamp";
import { demoOnlyUnavailable } from "@/lib/demoGate";
import { trustedClientCountry } from "@/lib/clientIp";
import { optionalRampAuth } from "@/lib/ramp/partnerAuth";

export const dynamic = "force-dynamic";

// POST /api/onramp/quote — fiat → crypto quote. Public (publishable-key)
// surface consumed by @furlpay/elements/onramp and the FurlPay apps.
//
// WHERE THE NUMBER COMES FROM
//   - FurlGateway (Coinbase CDP) configured → Coinbase's own Buy Quote API.
//     `source: "coinbase"`; the fee lines are Coinbase's.
//   - Not configured, outside production → the demo fee schedule in
//     lib/services/onramp.ts, labelled `source: "demo_schedule"`.
//   - Not configured, in production → 503. The demo schedule has hard-coded
//     FX for three currencies and silently priced every other fiat 1:1 with
//     USD (₹1,000 quoted as ~970 USDC). A made-up price is not a quote.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onramp.quote", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  // Public, but a presented API key must be valid, ramp-enabled and within
  // its own 60/min budget (lib/ramp/partnerAuth.ts).
  const partner = await optionalRampAuth(req, "quote");
  if (!partner.ok) return partner.res;

  const body = await validateBody(req, OnrampQuoteSchema);
  if (body instanceof NextResponse) return body;
  const paymentMethod = body.paymentMethod ?? "card";

  if (coinbaseRampBackend === "coinbase") {
    const country = trustedClientCountry(req);
    if (!country) {
      return NextResponse.json({ error: "country_unknown", detail: "Your country could not be determined." }, { status: 400 });
    }
    let quote;
    try {
      quote = await coinbaseBuyQuote({
        asset: body.token,
        chain: body.chain,
        fiatAmount: body.fiatAmount,
        fiatCurrency: body.fiatCurrency,
        paymentMethod,
        country,
        // Same platform header family as the trusted country above.
        subdivision: req.headers.get("x-vercel-ip-country-region") ?? undefined,
      });
    } catch (e) {
      console.error("[onramp/quote] coinbase quote failed:", (e as Error).message);
      return NextResponse.json({ error: "quote_unavailable" }, { status: 502 });
    }
    if (!quote) {
      return NextResponse.json(
        { error: "not_quotable", detail: `Coinbase does not quote ${body.token} on ${body.chain} by ${paymentMethod}.` },
        { status: 422 }
      );
    }
    const fee = Number(quote.coinbaseFee.value);
    const network = Number(quote.networkFee.value);
    return NextResponse.json({
      source: "coinbase",
      provider: "furlgateway",
      company: "Coinbase",
      quoteId: quote.quoteId,
      fiatAmount: body.fiatAmount,
      fiatCurrency: body.fiatCurrency,
      token: body.token,
      chain: body.chain,
      paymentMethod,
      cryptoAmount: Number(quote.purchaseAmount.value),
      paymentTotal: quote.paymentTotal,
      fees: { network, processing: fee, total: Math.round((fee + network) * 100) / 100 },
      // Coinbase does not state a quote lifetime; the client re-quotes rather
      // than showing a countdown we cannot back.
      expiresAt: null,
    });
  }

  const unavailable = demoOnlyUnavailable(
    "On-ramp quotes",
    "No on-ramp provider is configured, and the built-in fee schedule is a demo, not a price."
  );
  if (unavailable) return unavailable;

  return NextResponse.json({
    source: "demo_schedule",
    ...quoteOnramp({
      fiatAmount: body.fiatAmount,
      fiatCurrency: body.fiatCurrency,
      token: body.token,
      chain: body.chain,
      paymentMethod,
    }),
  });
}
