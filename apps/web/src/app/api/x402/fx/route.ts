import { NextRequest, NextResponse } from "next/server";
import { quoteFx } from "@/lib/services/fx";
import {
  X402_VERSION,
  buildRequirements,
  settlementHeader,
  verifyPayment,
} from "@/lib/x402";

// ---------------------------------------------------------------------------
// GET /api/x402/fx — pay-per-call premium API via x402 (HTTP 402).
//
// AI agents (and any HTTP client) buy a single mid-market FX quote for
// $0.01 USDC, no account or API key required:
//
//   1. GET /api/x402/fx?from=USD&to=EUR&amount=100      -> 402 + quote
//   2. sign EIP-3009 transferWithAuthorization for the quoted amount
//   3. retry with X-PAYMENT: base64(payload)            -> 200 + X-PAYMENT-RESPONSE
//
// Verification is hardened against the authorization / binding / replay /
// web-layer attack classes (see lib/x402.ts).
// ---------------------------------------------------------------------------

const PRICE_USD = 0.01;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const resource = `${url.origin}/api/x402/fx`;
  const from = (url.searchParams.get("from") || "USD").toUpperCase();
  const to = (url.searchParams.get("to") || "EUR").toUpperCase();
  const amount = Number(url.searchParams.get("amount") || "100");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const result = verifyPayment({
    header: req.headers.get("x-payment"),
    resource,
    method: "GET",
    priceUsd: PRICE_USD,
  });

  if (!result.ok) {
    if (result.status === 400) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    // 402: quote the payment. The client pays exactly this and retries.
    return NextResponse.json(
      {
        x402Version: X402_VERSION,
        error: result.error,
        accepts: [
          buildRequirements({
            resource,
            method: "GET",
            priceUsd: PRICE_USD,
            description: `Mid-market FX quote ${from}->${to} (per call)`,
          }),
        ],
      },
      { status: 402 }
    );
  }

  // Paid — serve the resource and attach the settlement receipt.
  const fx = await quoteFx(from, to, amount);
  const res = NextResponse.json({ paid: true, payer: result.payer, quote: fx });
  res.headers.set("X-PAYMENT-RESPONSE", settlementHeader(result.payer, result.txHash));
  return res;
}
