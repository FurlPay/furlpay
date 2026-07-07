import { NextRequest, NextResponse } from "next/server";
import {
  authorizeCart,
  toX402Settlement,
  memoryNonceStore,
  Ap2Error,
  type IntentMandate,
  type CartMandate,
  type Signed,
} from "@furlpay/ap2";
import { PAY_TO, NETWORK } from "@/lib/x402";

export const dynamic = "force-dynamic";

// Single-use nonce store across requests (production: Redis).
const g = globalThis as unknown as { __ap2Nonce?: ReturnType<typeof memoryNonceStore> };
const nonceStore = g.__ap2Nonce ?? (g.__ap2Nonce = memoryNonceStore());

// POST /api/agents/ap2 — accept an AP2 IntentMandate + CartMandate (both signed)
// and the signer public keys, verify + enforce all mandate constraints, and
// return the x402 settlement request FurlPay will execute. FurlPay is the first
// AP2 adapter that settles a cart over stablecoins. Public (the mandate
// signatures ARE the auth — an invalid cart 4xxs).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.cart || !body?.intent || !body?.userPublicKey || !body?.cartSignerPublicKey) {
    return NextResponse.json(
      { authorized: false, error: "cart, intent, userPublicKey and cartSignerPublicKey are required" },
      { status: 400 },
    );
  }

  try {
    const authorized = await authorizeCart({
      cart: body.cart as Signed<CartMandate>,
      intent: body.intent as Signed<IntentMandate>,
      userPublicKey: String(body.userPublicKey),
      cartSignerPublicKey: String(body.cartSignerPublicKey),
      nonceStore,
    });

    const settlement = toX402Settlement(authorized, { payTo: PAY_TO, network: NETWORK });

    return NextResponse.json({
      authorized: true,
      amount: authorized.amount,
      currency: authorized.currency,
      merchant: authorized.merchant,
      settlement,
    });
  } catch (e) {
    if (e instanceof Ap2Error) {
      return NextResponse.json({ authorized: false, code: e.code, error: e.message }, { status: 402 });
    }
    return NextResponse.json({ authorized: false, error: "ap2_authorization_failed" }, { status: 400 });
  }
}
