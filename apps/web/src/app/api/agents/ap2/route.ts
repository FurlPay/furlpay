import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import {
  authorizeCart,
  toX402Settlement,
  Ap2Error,
  type IntentMandate,
  type CartMandate,
  type Signed,
} from "@furlpay/ap2";
import { PAY_TO, NETWORK } from "@/lib/x402";
import { AP2_MAX_VALIDITY_MS, durableAp2NonceStore } from "@/lib/ap2NonceStore";
import { log } from "@/lib/log";
import { KvError } from "@/lib/kv";

export const dynamic = "force-dynamic";

// Signed envelopes are checked here for shape only; authorizeCart verifies the
// signatures and every mandate constraint, including exact amounts.
const SignedEnvelope = z
  .object({
    payload: z.record(z.unknown()),
    signature: z.string().min(1).max(512),
    keyId: z.string().min(1).max(512),
    alg: z.literal("ed25519"),
  })
  .strict();

const PublicKeyPem = z.string().min(1).max(2048);

const Ap2Body = z
  .object({
    cart: SignedEnvelope,
    intent: SignedEnvelope,
    userPublicKey: PublicKeyPem,
    cartSignerPublicKey: PublicKeyPem,
  })
  .strict();

// POST /api/agents/ap2 — accept an AP2 IntentMandate + CartMandate (both signed)
// and the signer public keys, verify + enforce all mandate constraints, and
// return the x402 settlement request FurlPay will execute. FurlPay is the first
// AP2 adapter that settles a cart over stablecoins. Public (the mandate
// signatures ARE the auth — an invalid cart 4xxs).
//
// Single use is enforced through a durable claim store (lib/ap2NonceStore.ts):
// a mandate replayed against another serverless instance is refused, and when
// the store is unreachable the request is refused with 503 rather than served
// from per-instance memory.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "agents.ap2", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Ap2Body, { maxBytes: 32 * 1024 });
  if (body instanceof NextResponse) return body;

  try {
    const authorized = await authorizeCart({
      cart: body.cart as unknown as Signed<CartMandate>,
      intent: body.intent as unknown as Signed<IntentMandate>,
      userPublicKey: body.userPublicKey,
      cartSignerPublicKey: body.cartSignerPublicKey,
      nonceStore: durableAp2NonceStore(),
      maxValidityMs: AP2_MAX_VALIDITY_MS,
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
    if (e instanceof KvError || (e instanceof Error && e.message.startsWith("kv."))) {
      log.error("ap2 replay store unavailable", { error: e.message.slice(0, 200) });
      return NextResponse.json(
        { authorized: false, error: "replay_protection_unavailable" },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }
    return NextResponse.json({ authorized: false, error: "ap2_authorization_failed" }, { status: 400 });
  }
}
