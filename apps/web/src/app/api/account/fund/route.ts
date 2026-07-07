import { NextRequest, NextResponse } from "next/server";
import { settle, type FacilitatorRequest } from "@/lib/x402Facilitator";
import { PAY_TO } from "@/lib/x402";
import { creditAccount, getAccountBalanceUsd } from "@/lib/services/account";

export const dynamic = "force-dynamic";

// This endpoint is UNAUTHENTICATED by design ("auth IS the x402 payment"), so a
// credit must never be mintable from an attacker-supplied payload. Two guards:
//  1. The payment must be addressed to OUR treasury (PAY_TO) — the generic
//     facilitator verify() trusts the caller's paymentRequirements.payTo, so
//     without this an attacker sets payTo = their own address and self-credits.
//  2. In production the default settler is a deterministic mock that "settles"
//     any well-formed (unsigned) authorization; crediting spendable balance off
//     a mock settlement is a free-mint. Require a real on-chain settler
//     (INTEGRATION_MODE=live) before crediting in production — mirrors the
//     prod guards in lib/session.ts, lib/auth/otp.ts and lib/auth/google.ts.
const FUNDING_IS_LIVE = process.env.INTEGRATION_MODE === "live";

// POST /api/account/fund — fund a FurlPay account balance via x402. Auth IS the
// x402 payment: an agent (or app) signs a USDC authorization, we settle it
// through the facilitator, and on success credit the spendable balance. This is
// the funding half of the loop — money in via x402, then spend on travel/cards/
// payouts. Body: an x402 FacilitatorRequest { paymentPayload, paymentRequirements }.
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && !FUNDING_IS_LIVE) {
    // No real settler wired → a mock "settlement" would credit real balance for
    // free. Refuse rather than fail open.
    return NextResponse.json(
      { funded: false, error: "funding_unavailable" },
      { status: 503 }
    );
  }

  let body: FacilitatorRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ funded: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body?.paymentPayload || !body?.paymentRequirements) {
    return NextResponse.json({ funded: false, error: "missing_fields" }, { status: 400 });
  }

  // The payment must be addressed to Furlpay's treasury, not a caller-chosen
  // address. The generic facilitator does not bind payTo server-side, so this
  // check is what makes "money in" actually mean money into our account.
  if ((body.paymentRequirements.payTo || "").toLowerCase() !== PAY_TO.toLowerCase()) {
    return NextResponse.json({ funded: false, error: "wrong_recipient" }, { status: 400 });
  }

  const result = await settle(body);
  if (!result.success) {
    return NextResponse.json({ funded: false, error: result.errorReason }, { status: 402 });
  }

  // The settled authorization value is atomic USDC (6 decimals).
  const atomic = body.paymentPayload.payload.authorization.value;
  const amountUsd = Number(BigInt(atomic)) / 1e6;
  const balanceUsd = creditAccount(
    amountUsd,
    `Account funded — $${amountUsd.toFixed(2)} USDC`,
    `x402 · ${result.network} · payer ${short(result.payer)}`
  );

  return NextResponse.json({
    funded: true,
    amountUsd: amountUsd.toFixed(2),
    transaction: result.transaction,
    network: result.network,
    payer: result.payer,
    balanceUsd: balanceUsd.toFixed(2),
  });
}

function short(a?: string): string {
  return a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? "unknown";
}
