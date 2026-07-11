import { NextRequest, NextResponse } from "next/server";
import { quoteFx } from "@/lib/services/fx";
import {
  buildChallenge,
  verifyMppPayment,
  receiptHeader,
  problemBody,
} from "@/lib/mpp";

export const dynamic = "force-dynamic";

// GET /api/mpp/fx — the same $0.01 FX resource as /api/x402/fx, exposed over
// the Machine Payments Protocol (Stripe/Tempo, paymentauth.org "Payment" HTTP
// auth scheme). Same settlement engine, different wire format — FurlPay speaks
// both agent-payment dialects:
//
//   1. GET /api/mpp/fx?from=USD&to=EUR&amount=100
//      -> 402 + `WWW-Authenticate: Payment id=… method=usdc-eip3009 request=…`
//   2. sign the EIP-3009 authorization for the quoted amount
//   3. retry with `Authorization: Payment <base64url credential>`
//      -> 200 + `Payment-Receipt: <base64url receipt>`
const PRICE_USD = 0.01;

function challenge402(realm: string, from: string, to: string, extra?: { problem: string; detail: string }) {
  const ch = buildChallenge({ realm, priceUsd: PRICE_USD, description: `Mid-market FX quote ${from}->${to} (per call)` });
  const res = NextResponse.json(
    problemBody(extra?.problem ?? "payment-required", extra?.detail ?? "Payment is required."),
    { status: 402 }
  );
  // Fresh challenge on every 402 (including credential failures) per spec.
  res.headers.set("WWW-Authenticate", ch.header);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Content-Type", "application/problem+json");
  return res;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const realm = `${url.origin}/api/mpp/fx`;
  const from = (url.searchParams.get("from") || "USD").toUpperCase();
  const to = (url.searchParams.get("to") || "EUR").toUpperCase();
  const amount = Number(url.searchParams.get("amount") || "100");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const authorization = req.headers.get("authorization");
  if (!authorization) return challenge402(realm, from, to);

  const result = await verifyMppPayment({ authorization, realm, priceUsd: PRICE_USD });
  if (!result.ok) {
    const res = challenge402(realm, from, to, { problem: result.problem, detail: result.detail });
    if (result.pending) {
      res.headers.set("Retry-After", "5");
      res.headers.set("X-Payment-Pending", JSON.stringify(result.pending));
    }
    return res;
  }

  // Paid — serve the resource with a receipt. `private` (not `no-store`) per
  // spec: a receipt-bearing response may sit in a private cache, never shared.
  const fx = await quoteFx(from, to, amount);
  const res = NextResponse.json({ paid: true, payer: result.payer, quote: fx });
  res.headers.set("Payment-Receipt", receiptHeader(result.reference));
  res.headers.set("Cache-Control", "private");
  return res;
}
