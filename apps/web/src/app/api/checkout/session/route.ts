import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { FURL_DECIMALS } from "@/lib/token/furl";
import { screenAddressRisk } from "@/lib/compliance/addressScreening";
import { CheckoutSchema, parse } from "@/lib/schemas";
import { createSession, getSession, toAtomic, toPublic } from "@/lib/checkout/session";
import { parseApiKey, verifyApiKey } from "@/lib/apiKeys";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/checkout/session — create a stablecoin checkout session.
// GET  /api/checkout/session?id=cs_… — poll its status.
//
// WHAT CHANGED, AND WHY IT MATTERED. This route previously ended with:
//
//     const transactionHash = "0x" + crypto.randomBytes(32).toString("hex");
//     return NextResponse.json({ status: "complete", transactionHash, ... });
//
// Every call returned a fabricated blockchain transaction hash and a completed
// status for a payment that had not happened. Nothing was persisted, no chain
// was contacted, and any non-empty X-Furlpay-Key was accepted. The published
// @furlpay/elements checkout button fed that hash straight into a merchant's
// onSuccess callback, so a merchant would ship goods against it.
//
// A session now starts at `requires_payment` and carries no transactionHash at
// all. It can only acquire one from `recordSettlement`, which requires an
// observed reference. There is no code path from "created" to "paid" that does
// not pass through evidence.
//
// The GET exists because a status that cannot be polled is a status a merchant
// has to take on trust, which is what the old response was asking them to do.
// ---------------------------------------------------------------------------

/** USDC and the other supported stablecoins are 6dp. Declared per token rather
 *  than assumed globally, so an 18dp asset cannot be silently mispriced. */
const TOKEN_DECIMALS: Readonly<Record<string, number>> = {
  USDC: 6,
  USDT: 6,
  EURC: 6,
  PYUSD: 6,
  /**
   * FURL, the FurlPay ecosystem token (Token-2022, 6dp — see lib/token/furl.ts,
   * which is where the decimals come from rather than being retyped here).
   *
   * No oracle is needed for this route and none is consulted: a checkout session
   * is denominated in the TOKEN (`amount` is token units, `currency` is only a
   * label), so "12.5 FURL" is fully defined without a FURL/USD rate. The
   * USD-priced path — Solana Actions, where an order in dollars has to be
   * converted — is separately gated on FURL_USD_PRICE and fails closed without
   * it. Do not "helpfully" add a default rate to either.
   *
   * A merchant invoicing in FURL is accepting an unpegged token with no market
   * price. That is their decision to make knowingly; see /token.
   */
  FURL: FURL_DECIMALS,
};

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "checkout.session", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const key = req.headers.get("x-furlpay-key");
  if (!key) {
    return NextResponse.json({ error: "Missing X-Furlpay-Key" }, { status: 401 });
  }

  // The key is RESOLVED, not merely parsed.
  //
  // A format check alone would still accept "pk_live_" + 65 arbitrary
  // characters, which is barely better than the `if (!key)` this replaced: it
  // would let anyone create sessions attributed to a merchant id they invented.
  // verifyApiKey performs the constant-time secret comparison and then
  // enforces revocation and expiry, so a key that was revoked an hour ago
  // stops working here too.
  //
  // "Publishable" describes what the key may DO — it ships in browser bundles
  // and therefore authorises nothing that moves money — not whether it must be
  // real. Stripe's pk_ keys are equally public and equally verified.
  const parsedKey = parseApiKey(key);
  if (!parsedKey || parsedKey.prefix !== "pk") {
    return NextResponse.json(
      {
        error: "invalid_publishable_key",
        message: "X-Furlpay-Key must be a publishable key (pk_live_… or pk_test_…).",
      },
      { status: 401 }
    );
  }

  const auth = await verifyApiKey(key);
  if (!auth.ok) {
    // One opaque body for every cause, as elsewhere: distinguishing "no such
    // key" from "wrong secret" turns this into an oracle for enumerating
    // merchant key ids.
    return NextResponse.json(
      {
        error: "invalid_publishable_key",
        message: "That publishable key is not valid.",
      },
      { status: 401 }
    );
  }

  const parsed = parse(CheckoutSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { amount, currency = "USD", token = "USDC", wallet } = parsed.data;

  const decimals = TOKEN_DECIMALS[token.toUpperCase()];
  if (decimals === undefined) {
    return NextResponse.json(
      { error: "unsupported_token", message: `FurlPay checkout does not support "${token}".` },
      { status: 400 }
    );
  }

  if (wallet) {
    // The settlement rail is chosen later, so screen by address family: an EVM
    // address on Ethereum (Circle's broadest EVM coverage), base58 on Solana.
    const screen = await screenAddressRisk(wallet, /^0x[0-9a-fA-F]{40}$/.test(wallet) ? "ethereum" : "solana");
    if (screen.action !== "allow") {
      return NextResponse.json({ error: "Wallet blocked by AML policy" }, { status: 403 });
    }
  }

  let amountAtomic: string;
  try {
    // `amount` arrives as a JSON number. It is converted to atomic units once,
    // here at the boundary, and every downstream figure is the integer.
    amountAtomic = toAtomic(amount.toFixed(decimals), decimals);
  } catch (e) {
    return NextResponse.json(
      { error: "invalid_amount", message: (e as Error).message },
      { status: 400 }
    );
  }

  const session = await createSession({
    merchantKeyId: auth.record.keyId,
    amountAtomic,
    decimals,
    currency,
    token: token.toUpperCase(),
    payerWallet: wallet ?? null,
  });

  return NextResponse.json(
    {
      ...toPublic(session),
      // Said explicitly, because the previous response said the opposite and
      // integrations may have been written against it.
      message:
        "Session created. No payment has been made yet — poll GET /api/checkout/session?id=… for status.",
    },
    { status: 201, headers: { "cache-control": "no-store" } }
  );
}

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "checkout.session.read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id", message: "Provide ?id=cs_…" }, { status: 400 });
  }

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(toPublic(session), { headers: { "cache-control": "no-store" } });
}
