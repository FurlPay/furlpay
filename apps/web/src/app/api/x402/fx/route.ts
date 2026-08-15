import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { quoteFx } from "@/lib/services/fx";
import {
  X402_VERSION,
  HEADER_V2_RECEIPT,
  HEADER_V2_REQUIRED,
  challenge,
  paymentRequiredHeader,
  readPaymentHeader,
  settlementHeader,
  settlementHeaderV2,
  verifyPayment,
  withNoStore,
} from "@/lib/x402";
import { assertRailActive } from "@/lib/ops/controls";
import { recordTxEvent, recordSecurityEvent } from "@/lib/ops/events";
import { recordRailHealth } from "@/lib/ops/overview";

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

// Flat per-call price. The quote binding below is deliberately coupled to this
// being a CONSTANT — see the note on `resource`.
const PRICE_USD = 0.01;

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "x402.fx", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const url = new URL(req.url);
  // Resource identity is the ENDPOINT, not the endpoint+query: one payment buys
  // one call to /api/x402/fx with whichever pair the agent picks. That is safe
  // only while PRICE_USD is param-independent — single-use (nonce + quoteId)
  // still gives exactly one call per payment, so nothing is free-ridden.
  //
  // If the price ever becomes a function of the query (charging more for exotic
  // pairs, say), this MUST become `${url.origin}${url.pathname}${url.search}` in
  // the same change — otherwise a payment quoted for a cheap pair would unlock
  // an expensive one. @furlpay/gateway binds the query by default for exactly
  // this reason.
  const resource = `${url.origin}/api/x402/fx`;
  const from = (url.searchParams.get("from") || "USD").toUpperCase();
  const to = (url.searchParams.get("to") || "EUR").toUpperCase();
  const amount = Number(url.searchParams.get("amount") || "100");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  // Emergency control: a paused x402 rail stops issuing quotes and settling.
  const paused = await assertRailActive("x402");
  if (paused) return withNoStore(paused);

  // v1 (X-PAYMENT) or v2 (PAYMENT-SIGNATURE) — either is accepted.
  const hasPayment = !!readPaymentHeader(req.headers);
  const result = await verifyPayment({
    headers: req.headers,
    resource,
    method: "GET",
    priceUsd: PRICE_USD,
  });

  // Feed the ops ledger with the REAL outcome (only when a payment was
  // presented — a bare 402 quote request is not a transaction).
  if (hasPayment) {
    if (result.ok) {
      await recordTxEvent({ rail: "x402", state: "settled", substate: "SETTLED", amountUsd: PRICE_USD, token: result.asset, txHash: result.txHash, payer: result.payer });
      await recordRailHealth("x402", "HEALTHY");
    } else if (result.pending) {
      await recordTxEvent({ rail: "x402", state: "pending", substate: "SETTLEMENT_PENDING", amountUsd: PRICE_USD, txHash: result.pending.transaction });
      await recordRailHealth("x402", "HEALTHY");
    } else if (/replay|already used|already redeemed/i.test(result.error)) {
      await recordSecurityEvent({ rail: "x402", kind: "replay_rejected", severity: "medium", detail: result.error });
    } else if (/signature/i.test(result.error)) {
      await recordSecurityEvent({ rail: "x402", kind: "bad_signature", severity: "high", detail: result.error });
    } else if (/binding|quote/i.test(result.error)) {
      await recordSecurityEvent({ rail: "x402", kind: "quote_tamper", severity: "high", detail: result.error });
    } else if (/recipient|addressed/i.test(result.error)) {
      await recordSecurityEvent({ rail: "x402", kind: "recipient_mismatch", severity: "high", detail: result.error });
    }
  }

  if (!result.ok) {
    if (result.status === 400) {
      return withNoStore(NextResponse.json({ error: result.error }, { status: 400 }));
    }
    // 402: quote the payment. The client pays exactly this and retries.
    //
    // ONE quote is minted and rendered in BOTH dialects — v2 in the
    // PAYMENT-REQUIRED header, v1 in the body. A v2 agent reads the header, a
    // v1 agent reads the body, and neither needs to know the other exists.
    // They share a quoteId, so the quote stays single-use across dialects.
    //
    // The quote carries a fresh single-use quoteId/binding, so it must not be
    // cached either (Attack III). `pending` (when present) means a settlement
    // was submitted but not yet confirmed — the client should poll its
    // statusPath before signing a fresh authorization.
    const description = `Mid-market FX quote ${from}->${to} (per call)`;
    // USDC always; XSGD (StraitsX, MAS-regulated) when deployed on the active
    // network — the agent picks its settlement asset.
    const quote = challenge({
      resource,
      method: "GET",
      priceUsd: PRICE_USD,
      description,
      error: result.error,
    });

    const res = withNoStore(
      NextResponse.json(
        {
          x402Version: X402_VERSION,
          error: result.error,
          ...(result.pending ? { pending: result.pending } : {}),
          accepts: quote.v1,
        },
        { status: 402 }
      )
    );
    res.headers.set(HEADER_V2_REQUIRED, paymentRequiredHeader(quote.v2));
    return res;
  }

  // Paid — serve the resource and attach the settlement receipt, in both
  // dialects. no-store keeps the paid response out of any shared/CDN cache
  // (Attack III cache leakage).
  const fx = await quoteFx(from, to, amount);
  const res = withNoStore(NextResponse.json({ paid: true, payer: result.payer, quote: fx }));
  res.headers.set("X-PAYMENT-RESPONSE", settlementHeader(result.payer, result.txHash, result.asset));
  res.headers.set(HEADER_V2_RECEIPT, settlementHeaderV2(result.payer, result.txHash, result.amountAtomic));
  return res;
}
