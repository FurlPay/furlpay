import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import crypto from "crypto";
import { screenWallet } from "@furlpay/compliance";
import { CheckoutSchema, parse } from "@/lib/schemas";

// POST /api/checkout/session — create a stablecoin checkout session for merchants
// (used by @furlpay/elements FurlpayCheckoutButton and the browser extension).
// body: { amount, currency?, token?, wallet? }
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "checkout.session", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const key = req.headers.get("x-furlpay-key");
  if (!key) {
    return NextResponse.json({ error: "Missing X-Furlpay-Key" }, { status: 401 });
  }

  const parsed = parse(CheckoutSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { amount, currency = "USD", token = "USDC", wallet } = parsed.data;

  // Screen the paying wallet if supplied.
  if (wallet) {
    const screen = screenWallet(wallet);
    if (screen.action === "block") {
      return NextResponse.json({ error: "Wallet blocked by AML policy", screen }, { status: 403 });
    }
  }

  const sessionId = "cs_" + crypto.randomBytes(10).toString("hex");
  const transactionHash = "0x" + crypto.randomBytes(32).toString("hex");

  return NextResponse.json({
    id: sessionId,
    status: "complete",
    amount,
    currency,
    token,
    transactionHash,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
}
