import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { screenWallet } from "@furlpay/compliance";
import { CheckoutSchema, parse } from "@/lib/schemas";
import { createSession, getSession, toAtomic, toPublic } from "@/lib/checkout/session";
import { parseApiKey } from "@/lib/apiKeys";

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
};

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "checkout.session", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const key = req.headers.get("x-furlpay-key");
  if (!key) {
    return NextResponse.json({ error: "Missing X-Furlpay-Key" }, { status: 401 });
  }

  // Format check, not authentication. The publishable key is public by
  // definition — it ships in browser bundles — so it identifies the merchant
  // and cannot authorise anything. Money still moves only when a rail reports
  // a real transaction, which is why creating a session on a merely
  // well-formed key is safe. Rejecting a malformed one keeps merchant
  // attribution meaningful.
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
    const screen = screenWallet(wallet);
    if (screen.action === "block") {
      return NextResponse.json({ error: "Wallet blocked by AML policy", screen }, { status: 403 });
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
    merchantKeyId: parsedKey.keyId,
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
